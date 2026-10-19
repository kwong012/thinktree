/**
 * Cline 源 — VSCode globalStorage/saoudrizwan.claude-dev/tasks/<taskId>/
 *   task_metadata.json
 *   api_conversation_history.json  [{role, content:[text|tool_use|tool_result]}]
 *   ui_messages.json
 *
 * 注：本机未检测到任务目录时 available=false、不显示。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventType, Status, createTurn, addUsage } from '../schema/trace.js';
import { readJson, mtime, usageOf, contentText, shortId, pickLive } from './util.js';

const APPDATA = process.env.APPDATA || '';
const CANDIDATES = [
  process.env.CLINE_TASKS_DIR,
  join(APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
  join(APPDATA, 'Code - Insiders', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
  join(APPDATA, 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
  join(APPDATA, 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
  join(APPDATA, 'Windsurf', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
].filter(Boolean);

const ROOT = CANDIDATES.find((p) => existsSync(p)) || CANDIDATES[0];
const PATTERNS = [/^Code$/i, /^Code - Insiders$/i, /^Cursor$/i, /^VSCodium$/i, /^Windsurf$/i];
const ALIVE_WINDOW = 30 * 60_000;

let cache = { at: 0, list: [], byId: new Map() };

function scan() {
  if (Date.now() - cache.at < 300) return cache;
  const list = [];
  const byId = new Map();

  let dirs = [];
  try {
    dirs = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    dirs = [];
  }

  for (const d of dirs) {
    const dir = join(ROOT, d.name);
    const meta = readJson(join(dir, 'task_metadata.json'), null);
    const history = join(dir, 'api_conversation_history.json');
    const ui = join(dir, 'ui_messages.json');
    if (!existsSync(history) && !existsSync(ui)) continue;

    const firstText = meta?.task || '';
    const item = {
      id: d.name,
      title: (firstText || d.name).slice(0, 120),
      agent: 'cline',
      model: {},
      directory: meta?.cwd || meta?.workspace || '',
      createdAt: meta?.createdAt || 0,
      updatedAt: Math.max(mtime(history), mtime(ui), mtime(join(dir, 'task_metadata.json'))),
      path: dir,
    };
    list.push(item);
    byId.set(item.id, item);
  }

  list.sort((a, b) => b.updatedAt - a.updatedAt);
  cache = { at: Date.now(), list, byId };
  return cache;
}

export function createClineSource() {
  return {
    id: 'cline',
    name: 'cline',
    interface: 'vscode',
    description: 'Cline VSCode 任务（globalStorage/tasks）',
    available: existsSync(ROOT),
    processPatterns: PATTERNS,

    listLive(procSnapshot) {
      const { list } = scan();
      return pickLive(procSnapshot, PATTERNS, list, { aliveWindow: ALIVE_WINDOW });
    },

    listSessions() {
      return scan().list;
    },

    getSession(id) {
      const { byId } = scan();
      const item = byId.get(id);
      return item ? buildSession(item) : null;
    },
  };
}

function buildSession(item) {
  const history = readJson(join(item.path, 'api_conversation_history.json'), []);
  const turns = [];
  let cur = null;
  let idx = 0;

  const newTurn = (at) => {
    const t = createTurn({
      id: `turn-${shortId(item.id)}-${idx}`,
      index: idx++,
      agent: 'cline',
      startedAt: at,
    });
    turns.push(t.turn);
    cur = t;
    return t;
  };
  const ensure = () => cur || newTurn(0);
  const finish = (status) => {
    if (!cur) return;
    const t = cur.turn;
    t.endedAt = t.events.at(-1)?.at ?? t.startedAt;
    t.durationMs = Math.max(0, t.endedAt - t.startedAt);
    t.status = status;
    cur = null;
  };

  for (const msg of Array.isArray(history) ? history : []) {
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content || '') }];

    if (msg.role === 'user') {
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();

      if (toolResults.length) {
        const t = ensure();
        for (const r of toolResults) {
          t.push(EventType.TOOL_RESULT, 0, {
            callId: r.tool_use_id,
            status: 'completed',
            output: contentText(r.content) || (typeof r.content === 'string' ? r.content : ''),
          });
        }
      }

      if (text) {
        finish(Status.OK);
        const t = newTurn(0);
        t.turn.prompt = text;
        t.push(EventType.PROMPT, 0, { text });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const t = ensure();
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
      const reasoning = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('\n');
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ callId: b.id, name: b.name, input: b.input }));

      t.push(EventType.MODEL_CALL, 0, {
        model: {},
        agent: 'cline',
        request: { note: 'Cline 未持久化原始请求；此处为可用元信息' },
        response: { text, reasoning, toolCalls },
      });

      for (const b of blocks) {
        if (b.type === 'thinking') t.push(EventType.REASONING, 0, { text: b.thinking || '' });
        else if (b.type === 'text') t.push(EventType.ANSWER, 0, { text: b.text || '' });
        else if (b.type === 'tool_use') {
          t.push(EventType.TOOL_CALL, 0, {
            callId: b.id,
            name: b.name,
            input: b.input,
            kind: String(b.name || '').startsWith('mcp') ? 'mcp' : 'builtin',
          });
        }
      }
    }
  }

  finish(Status.OK);

  return {
    id: item.id,
    sourceId: 'cline',
    title: item.title,
    agent: 'cline',
    model: item.model,
    directory: item.directory,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    usage: turns.reduce((acc, t) => addUsage(acc, t.usage), usageOf()),
    turns,
  };
}
