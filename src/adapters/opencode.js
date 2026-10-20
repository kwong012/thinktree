/**
 * opencode adapter
 * ----------------
 * Reads opencode's SQLite database and normalizes it into the universal
 * agent-trace schema (see ../schema/trace.js).
 *
 * opencode stores two generations of data:
 *   - v2  (current): `session_v2` + `session_message` (ordered event stream)
 *   - v1  (legacy) : `session` + `message` + `part` (message/part rows)
 * We prefer v2 and fall back to v1 for old sessions.
 *
 * Read-only: the DB is opened in read-only mode so a live opencode session can
 * keep writing while we observe.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  EventType,
  Status,
  createTurn,
  emptyUsage,
  addUsage,
  normalizeModel,
} from '../schema/trace.js';

const DEFAULT_DB =
  process.env.OPENCODE_DB || join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

function safeJson(str, fallback = {}) {
  if (str == null) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/** Pull a readable string out of a tool's state payload. */
function toolOutput(state) {
  if (!state) return '';
  if (Array.isArray(state.content)) {
    const txt = state.content
      .map((c) => (typeof c === 'string' ? c : c?.text ?? ''))
      .join('\n')
      .trim();
    if (txt) return txt;
  }
  if (typeof state.output === 'string') return state.output;
  if (state.output != null) return JSON.stringify(state.output);
  return '';
}

/** Compact response summary for a model-call node. */
function summarizeAssistantContent(content = []) {
  const text = content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n').trim();
  const reasoning = content.filter((c) => c.type === 'reasoning').map((c) => c.text || '').join('\n').trim();
  const toolCalls = content
    .filter((c) => c.type === 'tool')
    .map((c) => ({ callId: c.id || c.callID, name: c.name, input: c.state?.input ?? c.input }));
  return { text, reasoning, toolCalls };
}

/**
 * Classify a tool name so the UI can tell built-ins from MCP/plugin tools.
 * @param {string} name
 * @param {string[]} mcpServers known MCP server names from the config
 */
export function classifyTool(name, mcpServers = []) {
  if (!name) return { kind: 'unknown' };
  for (const s of mcpServers) {
    if (name === s || name.startsWith(`${s}_`) || name.startsWith(`${s}-`) || name.startsWith(`${s}.`)) {
      return { kind: 'mcp', server: s };
    }
  }
  return { kind: 'builtin' };
}

export function createOpencodeAdapter({ dbPath = DEFAULT_DB, mcpServers = [] } = {}) {
  let db;
  function open() {
    if (!db) db = new DatabaseSync(dbPath, { readOnly: true });
    return db;
  }

  function hasTable(name) {
    const row = open()
      .prepare("select 1 from sqlite_master where type='table' and name=?")
      .get(name);
    return !!row;
  }

  /** @returns {Array} light session summaries for the sidebar */
  function listSessions({ limit = 200, directory, titles = [] } = {}) {
    const v2 = hasTable('session_v2');
    const wanted = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))];
    const rows = [];
    if (v2) {
      const sql =
        'select s.id, s.title, s.agent, s.model, s.directory, s.time_created, s.time_updated, ' +
        's.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, s.tokens_cache_write, s.cost, ' +
        'p.worktree as worktree, p.name as project_name ' +
        'from session_v2 s left join project p on p.id = s.project_id ' +
        'order by s.time_created desc limit ?';
      for (const r of open().prepare(sql).all(limit)) {
        rows.push(mapSessionRow(r, 'v2'));
      }
    }
    if (hasTable('session')) {
      const sql =
        'select s.id, s.title, s.agent, s.model, s.directory, s.time_created, s.time_updated, ' +
        '0 as tokens_input, 0 as tokens_output, 0 as tokens_reasoning, 0 as tokens_cache_read, 0 as tokens_cache_write, s.cost, ' +
        'p.worktree as worktree, p.name as project_name ' +
        'from session s left join project p on p.id = s.project_id ' +
        'order by s.time_created desc limit ?';
      const known = new Set(rows.map((r) => r.id));
      for (const r of open().prepare(sql).all(limit)) {
        if (!known.has(r.id)) rows.push(mapSessionRow(r, 'v1'));
      }
    }

    // 当前会话可能很早创建、不在最近 limit 条里；只补查缺失的标题。
    const missingTitles = wanted.filter((t) => !rows.some((r) => r.title === t));
    if (missingTitles.length) {
      const placeholders = missingTitles.map(() => '?').join(',');
      const known = new Set(rows.map((r) => r.id));
      if (v2) {
        const sql =
          'select s.id, s.title, s.agent, s.model, s.directory, s.time_created, s.time_updated, ' +
          's.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, s.tokens_cache_write, s.cost, ' +
          'p.worktree as worktree, p.name as project_name ' +
          'from session_v2 s left join project p on p.id = s.project_id ' +
          `where s.title in (${placeholders})`;
        for (const r of open().prepare(sql).all(...missingTitles)) {
          if (known.has(r.id)) continue;
          rows.push(mapSessionRow(r, 'v2'));
          known.add(r.id);
        }
      }
      if (hasTable('session')) {
        const sql =
          'select s.id, s.title, s.agent, s.model, s.directory, s.time_created, s.time_updated, ' +
          '0 as tokens_input, 0 as tokens_output, 0 as tokens_reasoning, 0 as tokens_cache_read, 0 as tokens_cache_write, s.cost, ' +
          'p.worktree as worktree, p.name as project_name ' +
          'from session s left join project p on p.id = s.project_id ' +
          `where s.title in (${placeholders})`;
        for (const r of open().prepare(sql).all(...missingTitles)) {
          if (known.has(r.id)) continue;
          rows.push(mapSessionRow(r, 'v1'));
          known.add(r.id);
        }
      }
    }

    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    const filtered = directory ? rows.filter((r) => r.directory === directory) : rows;
    return filtered;
  }

  function mapSessionRow(r, generation) {
    return {
      id: r.id,
      title: r.title,
      agent: r.agent || null,
      model: normalizeModel(safeJson(r.model, {})),
      directory: r.directory,
      worktree: r.worktree || null,
      projectName: r.project_name || null,
      generation,
      createdAt: r.time_created,
      updatedAt: r.time_updated,
      usage: {
        input: r.tokens_input || 0,
        output: r.tokens_output || 0,
        reasoning: r.tokens_reasoning || 0,
        cacheRead: r.tokens_cache_read || 0,
        cacheWrite: r.tokens_cache_write || 0,
        cost: r.cost || 0,
      },
    };
  }

  /** Full normalized session with turns. */
  function getSession(id) {
    const header = getHeader(id);
    if (!header) return null;

    const msgs = hasTable('session_message')
      ? open()
          .prepare('select id, type, seq, time_created, data from session_message where session_id=? order by seq')
          .all(id)
      : [];

    const turns = msgs.length ? buildTurnsFromV2(msgs, header) : buildTurnsFromLegacy(id, header);

    const usage = emptyUsage();
    for (const t of turns) addUsage(usage, t.usage);
    if (usage.cost === 0 && !usage.input && !usage.output) addUsage(usage, header.usage);

    return {
      id: header.id,
      sourceId: 'opencode',
      title: header.title,
      agent: header.agent,
      model: header.model,
      directory: header.directory,
      worktree: header.worktree,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      usage,
      turns,
    };
  }

  function getHeader(id) {
    if (hasTable('session_v2')) {
      const r = open()
        .prepare(
          'select s.id, s.title, s.agent, s.model, s.directory, s.time_created, s.time_updated, ' +
            's.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, s.tokens_cache_write, s.cost, ' +
            'p.worktree as worktree from session_v2 s left join project p on p.id=s.project_id where s.id=?',
        )
        .get(id);
      if (r) return mapSessionRow(r, 'v2');
    }
    if (hasTable('session')) {
      const r = open()
        .prepare(
          'select s.id, s.title, s.agent, s.model, s.directory, s.time_created, s.time_updated, ' +
            '0 as tokens_input, 0 as tokens_output, 0 as tokens_reasoning, 0 as tokens_cache_read, 0 as tokens_cache_write, s.cost, ' +
            'p.worktree as worktree from session s left join project p on p.id=s.project_id where s.id=?',
        )
        .get(id);
      if (r) return mapSessionRow(r, 'v1');
    }
    return null;
  }

  // ---- v2: session_message event stream ----------------------------------

  function buildTurnsFromV2(msgs, header) {
    const turns = [];
    let cur = null;
    let idx = 0;

    const ensure = (at) => {
      if (!cur) {
        const t = createTurn({
          id: `turn-${id_short(header.id)}-${idx}`,
          index: idx++,
          model: header.model,
          agent: header.agent,
          startedAt: at,
        });
        cur = t;
        turns.push(t.turn);
      }
      return cur;
    };

    for (const m of msgs) {
      const d = safeJson(m.data, {});
      const at = d.time?.created ?? m.time_created; // eslint-disable-line

      if (m.type === 'user') {
        finalize(cur, cur ? (cur.turn.error ? Status.ERROR : Status.OK) : undefined);
        const t = createTurn({
          id: `turn-${id_short(header.id)}-${idx}`,
          index: idx++,
          model: normalizeModel(d.metadata?.model) || header.model,
          agent: d.metadata?.agent || header.agent,
          startedAt: at,
        });
        cur = t;
        turns.push(t.turn);
        const text = d.text || d.metadata?.displayText || '';
        t.turn.prompt = text;
        t.push(EventType.PROMPT, at, {
          text,
          attachments: (d.metadata?.attachments || []).map((a) => ({ name: a.name, path: a.path, mime: a.mime })),
          agent: t.turn.agent,
          model: t.turn.model,
        });
        continue;
      }

      const t = ensure(at);
      const turn = t.turn;

      if (m.type === 'assistant') {
        if (d.model) turn.model = turn.model?.id ? turn.model : normalizeModel(d.model);
        if (d.agent) turn.agent = turn.agent || d.agent;
        if (d.provider) turn.provider = d.provider;

        t.push(EventType.MODEL_CALL, at, {
          model: turn.model,
          provider: d.provider,
          agent: turn.agent,
          request: { note: 'opencode 未持久化原始模型请求；此处为可用元信息' },
          response: {
            ...summarizeAssistantContent(d.content),
            usage: usageFromTokens(d.tokens, d.cost),
            finish: d.finish,
          },
        });

        for (const c of d.content || []) {
          if (c.type === 'reasoning') {
            t.push(EventType.REASONING, c.time?.start ?? at, {
              text: c.text || '',
              durationMs: c.time?.end && c.time?.start ? c.time.end - c.time.start : null,
            });
          } else if (c.type === 'text') {
            t.push(EventType.ANSWER, c.time?.start ?? at, { text: c.text || '' });
          } else if (c.type === 'tool') {
            const state = c.state || {};
            const info = classifyTool(c.name, mcpServers);
            t.push(EventType.TOOL_CALL, c.time?.created ?? at, {
              callId: c.id || c.callID,
              name: c.name,
              kind: info.kind,
              server: info.server,
              input: state.input ?? c.input ?? {},
            });
            t.push(EventType.TOOL_RESULT, c.time?.completed ?? c.time?.ran ?? at, {
              callId: c.id || c.callID,
              name: c.name,
              kind: info.kind,
              server: info.server,
              status: state.status || 'completed',
              output: toolOutput(state),
              durationMs: c.time?.completed && c.time?.created ? c.time.completed - c.time.created : null,
            });
          }
        }

        if (d.tokens || d.cost != null) {
          const u = usageFromTokens(d.tokens, d.cost);
          addUsage(turn.usage, u);
          t.push(EventType.STEP, d.time?.completed ?? d.time?.streamed ?? at, { usage: u, finish: d.finish });
        }
        if (d.finish === 'error' && d.error) {
          turn.error = { type: d.error.type, message: d.error.message };
        }
        continue;
      }

      if (m.type === 'system') {
        t.push(EventType.CONTEXT, at, {
          source: 'system',
          notice: d.metadata?.notice,
          instructionSources: d.metadata?.instructionSources || [],
          text: d.text || '',
        });
      } else if (m.type === 'synthetic') {
        t.push(EventType.CONTEXT, at, { source: 'synthetic', text: d.text || '' });
      } else if (m.type === 'agent-switched') {
        t.push(EventType.SWITCH, at, { kind: 'agent', from: d.previous, to: d.agent });
        turn.agent = d.agent;
      } else if (m.type === 'model-switched') {
        t.push(EventType.SWITCH, at, { kind: 'model', from: normalizeModel(d.previous), to: normalizeModel(d.model) });
        turn.model = normalizeModel(d.model);
      } else if (m.type === 'location-switched') {
        t.push(EventType.NOTE, at, { kind: 'location', directory: d.location?.directory, text: `switched to ${d.location?.directory}` });
      } else if (m.type === 'idle') {
        const status = d.outcome === 'failed' ? Status.ERROR : Status.OK; // eslint-disable-line
        if (d.error) turn.error = { type: d.error.type, message: d.error.message };
        t.push(EventType.STATUS, d.time?.created ?? at, { outcome: d.outcome || 'succeeded' });
        finalize(t, status);
        cur = null;
      } else {
        t.push(EventType.NOTE, at, { kind: m.type, raw: d });
      }
    }
    finalize(cur);
    return turns;
  }

  // ---- v1: message + part ------------------------------------------------

  function buildTurnsFromLegacy(sessionId, header) {
    if (!hasTable('message') || !hasTable('part')) return [];
    const msgs = open()
      .prepare('select id, data from message where session_id=? order by time_created')
      .all(sessionId);
    const turns = [];
    let cur = null;
    let idx = 0;
    for (const m of msgs) {
      const info = safeJson(m.data, {});
      const at = info.time?.created ?? 0;
      if (info.role === 'user') {
        finalize(cur, cur ? (cur.turn.error ? Status.ERROR : Status.OK) : undefined);
        const t = createTurn({
          id: `turn-${id_short(sessionId)}-${idx}`,
          index: idx++,
          model: normalizeModel(info.model) || header.model,
          agent: info.agent || header.agent,
          startedAt: at,
        });
        cur = t;
        turns.push(t.turn);
        const parts = open().prepare('select data from part where message_id=? order by time_created').all(m.id);
        const text = parts.map((p) => safeJson(p.data, {}).text).filter(Boolean).join('\n');
        t.turn.prompt = text;
        t.push(EventType.PROMPT, at, { text });
      } else if (info.role === 'assistant') {
        if (!cur) continue;
        if (info.agent) cur.turn.agent = cur.turn.agent || info.agent;
        if (info.model) cur.turn.model = cur.turn.model?.id ? cur.turn.model : normalizeModel(info.model);
        if (info.error) cur.turn.error = { type: info.error.type, message: info.error.message };
        if (info.time?.completed) cur.turn.endedAt = info.time.completed;
        const parts = open().prepare('select data from part where message_id=? order by time_created').all(m.id);
        const partData = parts.map((p) => safeJson(p.data, {}));
        const stepFinish = partData.find((pd) => pd.type === 'step-finish');
        cur.push(EventType.MODEL_CALL, info.time?.completed ?? at, {
          model: cur.turn.model,
          agent: cur.turn.agent,
          request: { note: 'opencode 未持久化原始模型请求；此处为可用元信息' },
          response: {
            text: partData.filter((pd) => pd.type === 'text').map((pd) => pd.text || '').join('\n').trim(),
            reasoning: partData.filter((pd) => pd.type === 'reasoning').map((pd) => pd.text || '').join('\n').trim(),
            toolCalls: partData
              .filter((pd) => pd.type === 'tool')
              .map((pd) => ({ callId: pd.callID, name: pd.tool, input: pd.state?.input })),
            usage: usageFromTokens(stepFinish?.tokens, stepFinish?.cost),
            finish: stepFinish?.reason,
          },
        });
        for (const p of parts) {
          const pd = safeJson(p.data, {});
          if (pd.type === 'reasoning') {
            cur.push(EventType.REASONING, pd.time?.start ?? at, { text: pd.text || '', durationMs: pd.time?.end && pd.time?.start ? pd.time.end - pd.time.start : null });
          } else if (pd.type === 'text') {
            cur.push(EventType.ANSWER, pd.time?.start ?? at, { text: pd.text || '' });
          } else if (pd.type === 'tool') {
            const info2 = classifyTool(pd.tool, mcpServers);
            cur.push(EventType.TOOL_CALL, pd.state?.time?.start ?? at, { callId: pd.callID, name: pd.tool, kind: info2.kind, server: info2.server, input: pd.state?.input || {} });
            cur.push(EventType.TOOL_RESULT, pd.state?.time?.end ?? at, { callId: pd.callID, name: pd.tool, kind: info2.kind, server: info2.server, status: pd.state?.status, output: toolOutput(pd.state), durationMs: pd.state?.time?.end && pd.state?.time?.start ? pd.state.time.end - pd.state.time.start : null });
          } else if (pd.type === 'step-finish') {
            const u = usageFromTokens(pd.tokens, pd.cost);
            addUsage(cur.turn.usage, u);
            cur.push(EventType.STEP, at, { usage: u, reason: pd.reason });
          } else if (pd.type === 'patch') {
            cur.push(EventType.NOTE, at, { kind: 'patch', files: pd.files });
          } else if (pd.type === 'compaction') {
            cur.push(EventType.NOTE, at, { kind: 'compaction' });
          } else if (pd.type === 'subtask') {
            cur.push(EventType.NOTE, at, { kind: 'subtask', agent: pd.agent, text: pd.prompt || pd.description });
          }
        }
      }
    }
    finalize(cur);
    return turns;
  }

  function finalize(t, status) {
    if (!t) return;
    t.turn.endedAt = t.turn.events.at(-1)?.at ?? t.turn.startedAt;
    t.turn.durationMs = Math.max(0, t.turn.endedAt - t.turn.startedAt);
    if (status) t.turn.status = status;
  }

  return {
    id: 'opencode',
    name: 'opencode',
    interface: 'cli/tui',
    description: 'opencode 会话数据库 (session_v2 / session_message)',
    available: true,
    listSessions,
    getSession,
    source: { id: 'opencode', kind: 'opencode', name: 'opencode', dbPath },
  };
}

function usageFromTokens(tokens, cost) {
  const u = emptyUsage();
  if (tokens) {
    u.input = tokens.input || 0;
    u.output = tokens.output || 0;
    u.reasoning = tokens.reasoning || 0;
    u.cacheRead = tokens.cache?.read || 0;
    u.cacheWrite = tokens.cache?.write || 0;
  }
  u.cost = cost || 0;
  return u;
}

function id_short(id) {
  return String(id).replace(/^ses_/, '').slice(0, 8);
}
