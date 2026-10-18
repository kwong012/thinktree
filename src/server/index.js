#!/usr/bin/env node
/**
 * thinktree server
 * ----------------
 * 零依赖（node:http + node:sqlite）。只暴露**活会话**。
 *
 *   GET /api/proc                 进程/聚焦快照（调试）
 *   GET /api/agents               存活 agent + 各自活会话 + alive/focused
 *   GET /api/session/:source/:id  归一化会话（含 turns/events）
 *   GET /api/stream               SSE：agents 快照 + 会话增量
 *   GET /*                        前端构建产物（src/web/dist）
 */
import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const WEB_DIST = join(ROOT, 'src', 'web', 'dist');
const PORT = Number(process.env.PORT) || 5517;

const registry = createRegistry();

// 双击启动脚本时：浏览器全部关闭后自动退出，避免残留进程。
const EXIT_ON_CLOSE = process.env.TT_EXIT_ON_CLIENT_CLOSE === '1';
let sseClients = 0;
let shutdownTimer = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

async function serveFile(res, path) {
  try {
    const st = await stat(path);
    if (!st.isFile()) throw new Error('not a file');
    const buf = await readFile(path);
    res.writeHead(200, {
      'content-type': MIME[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

/** 会话指纹，用于判断是否需要推送。 */
function sessionSig(sess) {
  const t = sess.turns?.at(-1);
  return `${sess.updatedAt}:${sess.turns?.length || 0}:${t?.events?.length || 0}:${t?.status || ''}`;
}

function agentsSig(snap) {
  return JSON.stringify(
    snap.agents.map((a) => ({
      s: a.sourceId,
      f: a.focused,
      x: a.sessions.map((x) => `${x.id}:${x.updatedAt}`),
    })),
  );
}

const server = createHttpServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (path === '/api/proc') {
      return json(res, 200, { ...registry.proc.get(), fresh: registry.proc.isFresh() });
    }

    if (path === '/api/agents') {
      return json(res, 200, registry.snapshot());
    }

    let m = path.match(/^\/api\/session\/([^/]+)\/([^/]+)$/);
    if (m) {
      const sourceId = decodeURIComponent(m[1]);
      const id = decodeURIComponent(m[2]);
      const src = registry.getSource(sourceId);
      if (!src) return json(res, 404, { error: `source not found: ${sourceId}` });
      const sess = src.getSession(id);
      if (!sess) return json(res, 404, { error: 'session not found' });
      return json(res, 200, { ...sess, sourceId });
    }

    if (path === '/api/stream') return stream(req, res);

    // 静态资源（前端构建产物）
    const rel = path === '/' || path === '' ? 'index.html' : path.slice(1);
    const filePath = resolve(WEB_DIST, rel);
    if (!filePath.startsWith(resolve(WEB_DIST))) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (path === '/' || path === '') {
      try {
        await stat(join(WEB_DIST, 'index.html'));
      } catch {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(
          '<h1>thinktree</h1><p>前端未构建。运行 <code>npm run build:web</code> 后刷新。</p>',
        );
      }
    }
    return serveFile(res, filePath);
  } catch (err) {
    json(res, 500, { error: String(err?.stack || err) });
  }
});

/** SSE：agents 快照变化 + 每个活会话的增量。 */
function stream(req, res) {
  sseClients += 1;
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let lastAgents = '';
  const lastSessions = new Map();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const tick = () => {
    let snap;
    try {
      snap = registry.snapshot();
    } catch {
      return;
    }

    if (!req.destroyed) {
      const asig = agentsSig(snap);
      if (asig !== lastAgents) {
        lastAgents = asig;
        send('agents', snap);
      }

      for (const agent of snap.agents) {
        const src = registry.getSource(agent.sourceId);
        if (!src) continue;
        for (const s of agent.sessions) {
          let sess;
          try {
            sess = src.getSession(s.id);
          } catch {
            continue;
          }
          if (!sess) continue;
          const sig = sessionSig(sess);
          const prev = lastSessions.get(s.id);
          if (!prev || prev.sig !== sig) {
            const turnCount = sess.turns?.length || 0;
            // 轮数不变时只推最后一条（通常是正在增长的那一轮），避免每次传几 MB。
            if (!prev || prev.turnCount !== turnCount) {
              send('session', { ...sess, sourceId: agent.sourceId });
            } else {
              const lastTurn = sess.turns?.[sess.turns.length - 1] || null;
              send('session', {
                id: sess.id,
                sourceId: agent.sourceId,
                updatedAt: sess.updatedAt,
                partial: true,
                turns: lastTurn ? [lastTurn] : [],
              });
            }
            lastSessions.set(s.id, { sig, turnCount });
          }
        }
      }
    }
  };

  tick();
  const timer = setInterval(tick, 1200);
  req.on('close', () => {
    clearInterval(timer);
    sseClients = Math.max(0, sseClients - 1);

    if (EXIT_ON_CLOSE && sseClients === 0) {
      shutdownTimer = setTimeout(() => {
        if (sseClients > 0) return;
        console.log('browser closed; shutting down');
        try {
          server.close();
        } catch {
          // ignore
        }
        registry.proc?.stop?.();
        process.exit(0);
      }, 2000);
    }
  });
}

server.listen(PORT, () => {
  console.log(`thinktree listening on http://localhost:${PORT}`);
  console.log(`sources: ${registry.sources.map((s) => s.id).join(', ') || '(none)'}`);
});
