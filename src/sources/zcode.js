/**
 * ZCode 源 — ~/.zcode/cli/db/db.sqlite（session / message / part）
 *
 * 与 opencode 的 legacy 存储同构：message.data 带 role/model/tokens/cost，
 * part.data 带 text/reasoning/tool/step-finish。只读打开。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventType, Status, createTurn, addUsage, emptyUsage } from '../schema/trace.js';
import { safeJson, usageOf, shortId, pickLive } from './util.js';

const DB_PATH = process.env.ZCODE_DB || join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
const PATTERNS = [/^zcode/i];
const ALIVE_WINDOW = 30 * 60_000;

function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function hasTable(db, name) {
  return !!db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name);
}

function mapSessionRow(r) {
  return {
    id: r.id,
    title: r.title || r.id,
    agent: 'zcode',
    model: {},
    directory: r.directory,
    createdAt: r.time_created,
    updatedAt: r.time_updated,
  };
}

export function createZcodeSource() {
  let db = null;
  const getDb = () => {
    if (!db) db = openDb();
    return db;
  };

  return {
    id: 'zcode',
    name: 'zcode',
    interface: 'desktop/cli',
    description: 'ZCode 本地库（session / message / part）',
    available: existsSync(DB_PATH),
    processPatterns: PATTERNS,

    listLive(procSnapshot) {
      let rows = [];
      try {
        rows = getDb()
          .prepare(
            'select id, title, directory, time_created, time_updated from session order by time_updated desc limit 100',
          )
          .all();
      } catch {
        return { processes: [], sessions: [] };
      }

      const sessions = rows.map(mapSessionRow);

      return pickLive(procSnapshot, PATTERNS, sessions, { aliveWindow: ALIVE_WINDOW });
    },

    listSessions() {
      try {
        return getDb()
          .prepare(
            'select id, title, directory, time_created, time_updated from session order by time_updated desc',
          )
          .all()
          .map(mapSessionRow);
      } catch {
        return [];
      }
    },

    getSession(id) {
      try {
        return buildSession(getDb(), id);
      } catch {
        return null;
      }
    },
  };
}

function messageModel(d) {
  if (d.modelId || d.providerId) return { provider: d.providerId, id: d.modelId };
  if (d.model) return { provider: d.model.providerID || d.model.provider, id: d.model.modelID || d.model.id };
  const sel = d.modelSelection;
  if (sel) return { provider: sel.providerId, id: sel.modelId };
  return {};
}

function partText(parts) {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('\n')
    .trim();
}

function buildSession(db, id) {
  const header = db
    .prepare('select id, title, directory, time_created, time_updated from session where id=?')
    .get(id);
  if (!header) return null;

  const messages = db
    .prepare(
      'select id, data, time_created, sequence from message where session_id=? order by coalesce(sequence, time_created)',
    )
    .all(id);

  const partsStmt = db.prepare(
    'select data from part where message_id=? order by coalesce(sequence, time_created)',
  );

  const turns = [];
  let cur = null;
  let idx = 0;
  let model = {};

  const newTurn = (at) => {
    const t = createTurn({
      id: `turn-${shortId(id)}-${idx}`,
      index: idx++,
      model,
      agent: 'zcode',
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

  for (const m of messages) {
    const d = safeJson(m.data, {});
    const at = d.time?.created ?? m.time_created ?? 0;
    const parts = partsStmt.all(m.id).map((p) => safeJson(p.data, {}));

    if (d.role === 'user') {
      finish(Status.OK);
      const t = newTurn(at);
      const text = partText(parts);
      t.turn.prompt = text;
      t.push(EventType.PROMPT, at, { text });
      continue;
    }

    if (d.role === 'assistant') {
      const t = ensure(at);
      model = messageModel(d) || model;
      t.turn.model = model;
      if (d.error) t.turn.error = { type: d.error.type, message: d.error.message };

      const usage = usageOf({
        input: d.tokens?.input,
        output: d.tokens?.output,
        reasoning: d.tokens?.reasoning,
        cacheRead: d.tokens?.cache?.read,
        cacheWrite: d.tokens?.cache?.write,
        cost: d.cost,
      });

      t.push(EventType.MODEL_CALL, at, {
        model,
        provider: model.provider,
        agent: d.agent || 'zcode',
        request: { note: 'ZCode 本地库未持久化原始请求；原始 IO 见 rollout/model-io' },
        response: {
          text: partText(parts),
          reasoning: parts.filter((p) => p.type === 'reasoning').map((p) => p.text || '').join('\n'),
          toolCalls: parts
            .filter((p) => p.type === 'tool')
            .map((p) => ({ callId: p.callID, name: p.tool, input: p.state?.input })),
          usage,
          finish: d.finish,
        },
      });

      addUsage(t.turn.usage, usage);

      for (const p of parts) {
        if (p.type === 'reasoning') {
          t.push(EventType.REASONING, p.time?.start ?? at, { text: p.text || '' });
        } else if (p.type === 'text') {
          t.push(EventType.ANSWER, p.time?.start ?? at, { text: p.text || '' });
        } else if (p.type === 'tool') {
          const st = p.state || {};
          t.push(EventType.TOOL_CALL, st.time?.start ?? at, {
            callId: p.callID,
            name: p.tool,
            kind: 'builtin',
            input: st.input || {},
          });
          t.push(EventType.TOOL_RESULT, st.time?.end ?? at, {
            callId: p.callID,
            name: p.tool,
            status: st.status,
            output: typeof st.output === 'string' ? st.output : JSON.stringify(st.output ?? ''),
            durationMs:
              st.time?.end && st.time?.start ? st.time.end - st.time.start : null,
          });
        } else if (p.type === 'step-finish') {
          t.push(EventType.STEP, at, { usage, reason: p.reason });
        } else if (p.type === 'patch') {
          t.push(EventType.NOTE, at, { kind: 'patch', files: p.files });
        }
      }

      if (d.time?.completed) t.push(EventType.STATUS, d.time.completed, { outcome: d.finish || 'ok' });
      continue;
    }

    ensure(at).push(EventType.NOTE, at, { kind: d.role || 'message' });
  }

  finish(Status.OK);

  const usage = emptyUsage();
  for (const t of turns) addUsage(usage, t.usage);

  return {
    id: header.id,
    sourceId: 'zcode',
    title: header.title || header.id,
    agent: 'zcode',
    model,
    directory: header.directory,
    createdAt: header.time_created,
    updatedAt: header.time_updated,
    usage,
    turns,
  };
}
