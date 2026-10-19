/**
 * pi 源 — ~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl
 *
 * 记录类型：session / model_change / message(role=user|assistant|toolResult|system)
 * assistant.message.content 内含 thinking / text / toolCall，并带 usage。
 */
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  EventType,
  Status,
  createTurn,
  addUsage,
} from '../schema/trace.js';
import { findProcesses } from '../proc.js';
import { getPiSessionName, startTerminalWatcher } from '../terminal.js';
import {
  safeJson,
  readFirstLine,
  readJsonl,
  walkFiles,
  mtime,
  usageOf,
  contentText,
  timeMs,
  dirName,
  shortId,
  pickLive,
  preferCwd,
} from './util.js';

const ROOT = process.env.PI_SESSION_DIR || join(homedir(), '.pi', 'agent', 'sessions');
const PATTERNS = [/^pi(\.exe)?$/i, /pi-launcher\.js/i, /pi-coding-agent/i];
const ALIVE_WINDOW = 30 * 60_000;

let cache = { at: 0, list: [], byId: new Map() };
const titleCache = new Map();

/** 用首条用户消息作为标题（只读文件头部 256KB）。 */
function scanHead(path) {
  const out = { title: '', name: '' };
  try {
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    for (const line of buf.subarray(0, n).toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'session_info' && row.name) out.name = row.name;
      if (!out.title && row.type === 'message' && row.message?.role === 'user') {
        const t = contentText(row.message.content).replace(/\s+/g, ' ').trim();
        if (t) out.title = t.slice(0, 90);
      }
    }
  } catch {}
  return out;
}

function scan() {
  if (Date.now() - cache.at < 300) return cache;
  const list = [];
  const byId = new Map();
  for (const path of walkFiles(ROOT, (p) => p.endsWith('.jsonl'))) {
    const head = safeJson(readFirstLine(path), {});
    if (head.type !== 'session' || !head.id) continue;
    const stamp = mtime(path);
    let cached = titleCache.get(path);
    if (!cached || cached.stamp !== stamp) {
      const info = scanHead(path);
      cached = { stamp, name: info.name, title: info.name || info.title || dirName(head.cwd) || head.id };
      titleCache.set(path, cached);
    }
    const item = {
      id: head.id,
      title: cached.title,
      name: cached.name || '',
      agent: 'pi',
      model: {},
      directory: head.cwd,
      createdAt: timeMs(head.timestamp),
      updatedAt: stamp,
      path,
    };
    list.push(item);
    byId.set(item.id, item);
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  cache = { at: Date.now(), list, byId };
  return cache;
}

export function createPiSource() {
  startTerminalWatcher();
  return {
    id: 'pi',
    name: 'pi',
    interface: 'cli/tui',
    description: 'pi 会话 JSONL（~/.pi/agent/sessions）',
    available: existsSync(ROOT),
    processPatterns: PATTERNS,

    listLive(procSnapshot) {
      const { list } = scan();
      const activeName = getPiSessionName();
      const live = pickLive(procSnapshot, PATTERNS, list, {
        aliveWindow: ALIVE_WINDOW,
        activeNames: activeName ? [activeName] : [],
      });
      live.sessions = preferCwd(live.sessions, live.processes);
      return live;
    },

    getSession(id) {
      const { byId } = scan();
      const item = byId.get(id);
      return item ? buildSession(item) : null;
    },
  };
}

function buildSession(item) {
  const rows = readJsonl(item.path);
  const turns = [];
  let cur = null;
  let idx = 0;
  let model = {};
  let lastStop = null;
  let pendingContext = [];

  const newTurn = (at) => {
    const t = createTurn({
      id: `turn-${shortId(item.id)}-${idx}`,
      index: idx++,
      model,
      agent: 'pi',
      startedAt: at,
    });
    turns.push(t.turn);
    cur = t;
    return t;
  };
  const ensure = (at) => cur || newTurn(at);
  const finish = (status) => {
    if (!cur) return;
    const t = cur.turn;
    t.endedAt = t.events.at(-1)?.at ?? t.startedAt;
    t.durationMs = Math.max(0, t.endedAt - t.startedAt);
    t.status = status;
    cur = null;
  };

  for (const row of rows) {
    const type = row.type;
    if (type === 'session') continue;

    if (type === 'model_change') {
      model = { provider: row.provider, id: row.modelId };
      if (cur) cur.push(EventType.SWITCH, timeMs(row.timestamp), { kind: 'model', to: model });
      continue;
    }

    if (type !== 'message') continue;
    const m = row.message || {};
    const at = m.timestamp || timeMs(row.timestamp);
    const role = m.role;

    if (role === 'user') {
      finish(Status.OK);
      const t = newTurn(at);
      for (const c of pendingContext) t.push(EventType.CONTEXT, c.at, c);
      pendingContext = [];
      const text = contentText(m.content);
      t.turn.prompt = text;
      t.push(EventType.PROMPT, at, { text });
      continue;
    }

    if (role === 'system') {
      const item = {
        source: 'system',
        text: contentText(m.content) || m.sections?.preamble || '',
      };
      if (cur) cur.push(EventType.CONTEXT, at, item);
      else pendingContext.push({ at, ...item });
      continue;
    }

    if (role === 'assistant') {
      const t = ensure(at);
      if (m.provider || m.model) model = { provider: m.provider, id: m.model };
      t.turn.model = model;
      lastStop = m.stopReason || null;

      const blocks = Array.isArray(m.content) ? m.content : [];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
      const reasoning = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('\n');
      const toolCalls = blocks
        .filter((b) => b.type === 'toolCall')
        .map((b) => ({ callId: b.id, name: b.name, input: b.arguments }));

      t.push(EventType.MODEL_CALL, at, {
        model,
        provider: m.provider,
        agent: 'pi',
        request: { note: 'pi 未持久化原始请求；此处为可用元信息' },
        response: {
          text,
          reasoning,
          toolCalls,
          usage: usageOf(m.usage),
          finish: m.stopReason,
        },
      });

      for (const b of blocks) {
        if (b.type === 'thinking') t.push(EventType.REASONING, at, { text: b.thinking || '' });
        else if (b.type === 'text') t.push(EventType.ANSWER, at, { text: b.text || '' });
        else if (b.type === 'toolCall') {
          t.push(EventType.TOOL_CALL, at, {
            callId: b.id,
            name: b.name,
            input: b.arguments,
            kind: String(b.name || '').startsWith('mcp') ? 'mcp' : 'builtin',
          });
        }
      }

      if (m.usage) {
        const u = usageOf(m.usage);
        addUsage(t.turn.usage, u);
        t.push(EventType.STEP, at, { usage: u, finish: m.stopReason });
      }
      continue;
    }

    if (role === 'toolResult') {
      const t = ensure(at);
      t.push(EventType.TOOL_RESULT, at, {
        callId: m.toolCallId,
        name: m.toolName,
        status: m.isError ? 'error' : 'completed',
        output: contentText(m.content),
        durationMs: m.durationMs ?? null,
      });
      continue;
    }
  }

  finish(lastStop === 'toolUse' ? Status.RUNNING : Status.OK);

  return {
    id: item.id,
    sourceId: 'pi',
    title: item.title,
    agent: 'pi',
    model,
    directory: item.directory,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    usage: turns.reduce((acc, t) => addUsage(acc, t.usage), usageOf()),
    turns,
  };
}
