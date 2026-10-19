/**
 * Kimi Code 源 — ~/.kimi-code/sessions/<wdKey>/<sessionId>/
 *   state.json        标题 / 时间
 *   agents/main/wire.jsonl  事件流：
 *     turn.prompt / context.append_loop_event(step.begin|content.part|tool.call|
 *     tool.result|step.end) / usage.record / ...
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventType, Status, createTurn, addUsage } from '../schema/trace.js';
import {
  readJson,
  readJsonl,
  mtime,
  usageOf,
  contentText,
  dirName,
  shortId,
  pickLive,
  preferCwd,
} from './util.js';

const ROOT = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
const SESSIONS = join(ROOT, 'sessions');
const PATTERNS = [/^kimi/i, /kimi[-_]code/i];
const ALIVE_WINDOW = 30 * 60_000;

let cache = { at: 0, list: [], byId: new Map(), workDirs: new Map() };

function loadWorkDirs() {
  const map = new Map();
  const idxPath = join(ROOT, 'session_index.jsonl');
  if (!existsSync(idxPath)) return map;
  for (const r of readJsonl(idxPath)) {
    if (r.sessionId && r.workDir) map.set(r.sessionId, r.workDir);
  }
  return map;
}

function scan() {
  if (Date.now() - cache.at < 300) return cache;
  const workDirs = loadWorkDirs();
  const list = [];
  const byId = new Map();

  let wds = [];
  try {
    wds = readdirSync(SESSIONS, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    wds = [];
  }

  for (const wd of wds) {
    const wdPath = join(SESSIONS, wd.name);
    let sds = [];
    try {
      sds = readdirSync(wdPath, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const sd of sds) {
      const dir = join(wdPath, sd.name);
      const state = readJson(join(dir, 'state.json'), null);
      const wire = join(dir, 'agents', 'main', 'wire.jsonl');
      if (!state || state.archived || !existsSync(wire)) continue;
      const id = state.id || sd.name;
      const item = {
        id,
        title: state.title || state.lastPrompt || dirName(workDirs.get(id)) || id,
        agent: 'kimi',
        model: {},
        directory: workDirs.get(id) || '',
        createdAt: state.createdAt || 0,
        updatedAt: Math.max(state.updatedAt || 0, mtime(wire)),
        path: wire,
      };
      list.push(item);
      byId.set(id, item);
    }
  }

  list.sort((a, b) => b.updatedAt - a.updatedAt);
  cache = { at: Date.now(), list, byId, workDirs };
  return cache;
}

function splitModel(s) {
  if (!s || typeof s !== 'string') return {};
  const i = s.indexOf('/');
  return i > 0 ? { provider: s.slice(0, i), id: s.slice(i + 1) } : { id: s };
}

export function createKimiSource() {
  return {
    id: 'kimi',
    name: 'kimi',
    interface: 'cli/desktop',
    description: 'Kimi Code 会话（~/.kimi-code/sessions）',
    available: existsSync(SESSIONS),
    processPatterns: PATTERNS,

    listLive(procSnapshot) {
      const { list } = scan();
      const live = pickLive(procSnapshot, PATTERNS, list, { aliveWindow: ALIVE_WINDOW });
      live.sessions = preferCwd(live.sessions, live.processes);
      return live;
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
  const rows = readJsonl(item.path, 8 * 1024 * 1024);
  const firstUsage = rows.find((r) => r.type === 'usage.record' && r.model);
  const turns = [];
  let cur = null;
  let idx = 0;
  let model = firstUsage ? splitModel(firstUsage.model) : {};
  let pendingStep = false;

  const newTurn = (at) => {
    const t = createTurn({
      id: `turn-${shortId(item.id)}-${idx}`,
      index: idx++,
      model,
      agent: 'kimi',
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
    const at = row.time || 0;

    if (type === 'usage.record') {
      const m = splitModel(row.model);
      if (m.id && !model.id) model = m;
      continue;
    }

    if (type === 'turn.prompt') {
      finish(Status.OK);
      const t = newTurn(at);
      const text = contentText(row.input) || row.text || '';
      t.turn.prompt = text;
      t.push(EventType.PROMPT, at, { text });
      continue;
    }

    if (type !== 'context.append_loop_event') continue;
    const e = row.event || {};
    const t = ensure(at);

    if (e.type === 'step.begin') {
      pendingStep = true;
      t.push(EventType.MODEL_CALL, at, {
        model,
        provider: model.provider,
        agent: 'kimi',
        request: { note: 'Kimi wire 未持久化原始请求；此处为可用元信息' },
        response: { finish: null },
      });
      continue;
    }

    if (e.type === 'step.end') {
      pendingStep = false;
      const u = usageOf({
        input: e.usage?.inputOther,
        output: e.usage?.output,
        cacheRead: e.usage?.inputCacheRead,
        cacheWrite: e.usage?.inputCacheCreation,
      });
      addUsage(t.turn.usage, u);
      t.push(EventType.STEP, at, { usage: u, finish: e.finishReason });
      continue;
    }

    if (e.type === 'content.part') {
      const part = e.part || {};
      if (part.type === 'think') t.push(EventType.REASONING, at, { text: part.think || '' });
      else if (part.type === 'text') t.push(EventType.ANSWER, at, { text: part.text || '' });
      continue;
    }

    if (e.type === 'tool.call') {
      const name = e.name || '';
      t.push(EventType.TOOL_CALL, at, {
        callId: e.toolCallId,
        name,
        input: e.args,
        description: e.description,
        kind: name.startsWith('mcp__') ? 'mcp' : 'builtin',
        server: name.startsWith('mcp__') ? name.split('__')[1] : undefined,
      });
      continue;
    }

    if (e.type === 'tool.result') {
      t.push(EventType.TOOL_RESULT, at, {
        callId: e.toolCallId,
        status: e.result?.isError ? 'error' : 'completed',
        output: e.result?.output ?? '',
      });
    }
  }

  finish(pendingStep ? Status.RUNNING : Status.OK);

  return {
    id: item.id,
    sourceId: 'kimi',
    title: item.title,
    agent: 'kimi',
    model,
    directory: item.directory,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    usage: turns.reduce((acc, t) => addUsage(acc, t.usage), usageOf()),
    turns,
  };
}
