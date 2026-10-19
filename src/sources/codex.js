/**
 * Codex 源 — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * 记录：session_meta / turn_context / response_item(message|reasoning|function_call|
 * function_call_output) / event_msg(task_started|task_complete|token_count|...)。
 * Desktop 与 CLI 写同一目录。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventType, Status, createTurn, addUsage } from '../schema/trace.js';
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

const ROOT = process.env.CODEX_SESSION_DIR || join(homedir(), '.codex', 'sessions');
const PATTERNS = [/^codex(\.exe)?$/i];
const ALIVE_WINDOW = 30 * 60_000;

let cache = { at: 0, list: [], byId: new Map() };

function scan() {
  if (Date.now() - cache.at < 300) return cache;
  const list = [];
  const byId = new Map();
  for (const path of walkFiles(ROOT, (p) => /rollout-.*\.jsonl$/i.test(p))) {
    const head = safeJson(readFirstLine(path), {});
    if (head.type !== 'session_meta') continue;
    const p = head.payload || {};
    const id = p.session_id || p.id;
    if (!id) continue;
    const item = {
      id,
      title: dirName(p.cwd) || id,
      agent: 'codex',
      model: { provider: p.model_provider, id: null },
      directory: p.cwd,
      createdAt: timeMs(p.timestamp || head.timestamp),
      updatedAt: mtime(path),
      path,
    };
    list.push(item);
    byId.set(id, item);
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  cache = { at: Date.now(), list, byId };
  return cache;
}

export function createCodexSource() {
  return {
    id: 'codex',
    name: 'codex',
    interface: 'cli/desktop',
    description: 'Codex rollout JSONL（~/.codex/sessions）',
    available: existsSync(ROOT),
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
  const rows = readJsonl(item.path);
  const turns = [];
  let cur = null;
  let idx = 0;
  let model = { ...item.model };
  let completed = true;
  let pendingContext = [];

  const newTurn = (at) => {
    const t = createTurn({
      id: `turn-${shortId(item.id)}-${idx}`,
      index: idx++,
      model,
      agent: 'codex',
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
    const at = timeMs(row.timestamp);
    const payload = row.payload || {};

    if (row.type === 'session_meta') continue;

    if (row.type === 'turn_context') {
      if (payload.model) model = { ...model, id: payload.model };
      continue;
    }

    if (row.type === 'world_state') {
      const cm = payload.state?.collaboration_mode;
      if (cm?.model) model = { ...model, id: cm.model };
      continue;
    }

    if (row.type === 'event_msg') {
      const et = payload.type;
      if (et === 'task_started') {
        completed = false;
      } else if (et === 'task_complete') {
        completed = true;
        finish(Status.OK);
      } else if (et === 'token_count') {
        const u = payload.info?.last_token_usage;
        if (u) {
          const step = usageOf({
            input: u.input_tokens,
            output: u.output_tokens,
            reasoning: u.reasoning_output_tokens,
            cacheRead: u.cached_input_tokens,
          });
          const t = ensure(at);
          addUsage(t.turn.usage, step);
          t.push(EventType.STEP, at, { usage: step });
        }
      } else if (et === 'thread_settings_applied') {
        const m = payload.thread_settings?.model;
        if (m) model = { ...model, id: m };
      }
      continue;
    }

    if (row.type !== 'response_item') continue;
    const q = payload;

    if (q.type === 'message') {
      const text = contentText(q.content);
      if (q.role === 'user') {
        finish(Status.OK);
        const t = newTurn(at);
        for (const c of pendingContext) t.push(EventType.CONTEXT, c.at, c);
        pendingContext = [];
        t.turn.prompt = text;
        t.push(EventType.PROMPT, at, { text });
      } else if (q.role === 'assistant') {
        const t = ensure(at);
        t.push(EventType.MODEL_CALL, at, {
          model,
          provider: model.provider,
          agent: 'codex',
          request: { note: 'Codex rollout 未持久化原始请求；此处为可用元信息' },
          response: { text, finish: q.phase },
        });
        if (text) t.push(EventType.ANSWER, at, { text });
      } else {
        const item = { source: q.role, text };
        if (cur) cur.push(EventType.CONTEXT, at, item);
        else pendingContext.push({ at, ...item });
      }
      continue;
    }

    if (q.type === 'reasoning') {
      const text = contentText(q.summary) || contentText(q.content);
      if (text) ensure(at).push(EventType.REASONING, at, { text });
      continue;
    }

    if (q.type === 'function_call') {
      ensure(at).push(EventType.TOOL_CALL, at, {
        callId: q.call_id,
        name: q.name,
        input: safeJson(q.arguments, {}),
        kind: 'builtin',
      });
      continue;
    }

    if (q.type === 'function_call_output') {
      ensure(at).push(EventType.TOOL_RESULT, at, {
        callId: q.call_id,
        output: typeof q.output === 'string' ? q.output : JSON.stringify(q.output ?? ''),
        status: 'completed',
      });
    }
  }

  finish(completed ? Status.OK : Status.RUNNING);

  return {
    id: item.id,
    sourceId: 'codex',
    title: item.title,
    agent: 'codex',
    model,
    directory: item.directory,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    usage: turns.reduce((acc, t) => addUsage(acc, t.usage), usageOf()),
    turns,
  };
}
