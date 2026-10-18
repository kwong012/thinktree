/**
 * Universal Agent-Trace Schema
 * ----------------------------
 * Every agent (opencode, Claude Code, a custom loop, ...) is normalized by an
 * adapter into this shape. Views (timeline / tree / live) only ever read this
 * shape, so adding a new agent means writing one adapter, not touching the UI.
 *
 *   Source   where the trace came from (a worktree / project folder / db)
 *   Session  an ordered group of Turns
 *   Turn     ONE prompt -> answer cycle ("每次提问后到返回答案中间的过程")
 *   Event    one step inside a turn, in the order information flowed
 *
 * The events array is the heart of it: it is the literal information flow.
 */

/** Event kinds, in the order they typically occur within a turn. */
export const EventType = {
  PROMPT: 'prompt', //        the user's question / instruction
  CONTEXT: 'context', //      system + synthetic context injected before the model runs
  MODEL_CALL: 'model-call', // one model invocation: request (what we sent) + response (what came back)
  REASONING: 'reasoning', //  model "thinking" tokens
  TOOL_CALL: 'tool-call', //   model asks to run a tool
  TOOL_RESULT: 'tool-result', // the tool's output comes back
  STEP: 'step', //            one model round-trip finished (tokens + cost for it)
  ANSWER: 'answer', //        model text shown to the user
  SWITCH: 'switch', //        agent or model changed mid-turn
  STATUS: 'status', //        turn outcome: ok / error / aborted
  NOTE: 'note', //            anything else (location change, compaction, ...)
};

export const Status = { OK: 'ok', ERROR: 'error', ABORTED: 'aborted', RUNNING: 'running' };

/** @typedef {{provider?: string, id?: string, variant?: string}} Model */
/** @typedef {{input?: number, output?: number, reasoning?: number, cacheRead?: number, cacheWrite?: number, cost?: number}} Usage */
/**
 * @typedef {object} TraceEvent
 * @property {number} seq        global order within the turn (0-based)
 * @property {string} type       one of EventType
 * @property {number} at         epoch ms
 * @property {object} [data]     type-specific payload
 *
 * model-call data:
 *   { model, provider, agent,
 *     request:  { note?, messages?, tools?, raw? },   // 发给模型的（能拿到的部分）
 *     response: { text?, reasoning?, toolCalls?, usage?, finish?, raw? } }
 * raw 仅在源存储了原始 request/response 时存在（如 ZCode model-io-*.jsonl）。
 */
/**
 * @typedef {object} Turn
 * @property {string} id
 * @property {number} index
 * @property {Model} model
 * @property {string} [agent]
 * @property {string} [provider]
 * @property {number} startedAt
 * @property {number|null} endedAt
 * @property {number|null} durationMs
 * @property {string} status     one of Status
 * @property {Usage} usage
 * @property {TraceEvent[]} events
 * @property {{type?:string, message?:string}} [error]
 * @property {string} [prompt]   convenience: the prompt text
 */
/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} sourceId
 * @property {string} title
 * @property {string} agent
 * @property {Model} model
 * @property {string} directory    folder / worktree this session ran in
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {Usage} usage
 * @property {Turn[]} turns
 */
/** @typedef {{id:string, kind:string, name:string, directory?:string}} Source */

/** @returns {Usage} */
export function emptyUsage() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/** Add `b` into `a` in place. @param {Usage} a @param {Usage} b */
export function addUsage(a, b) {
  if (!b) return a;
  a.input += b.input || 0;
  a.output += b.output || 0;
  a.reasoning += b.reasoning || 0;
  a.cacheRead += b.cacheRead || 0;
  a.cacheWrite += b.cacheWrite || 0;
  a.cost += b.cost || 0;
  return a;
}

/** Normalize the many model shapes into {provider,id,variant}. */
export function normalizeModel(m) {
  if (!m) return {};
  if (typeof m === 'string') return { id: m };
  return {
    provider: m.providerID ?? m.provider ?? undefined,
    id: m.modelID ?? m.id ?? undefined,
    variant: m.variant ?? undefined,
  };
}

export function modelLabel(m) {
  if (!m || !m.id) return 'unknown';
  const prov = m.provider ? `${m.provider}/` : '';
  const v = m.variant && m.variant !== 'default' ? ` (${m.variant})` : '';
  return `${prov}${m.id}${v}`;
}

/**
 * Create a turn accumulator. Adapters push events; `done()` finalizes timing,
 * status and rolls up usage.
 * @param {{id:string, index:number, model?:Model, agent?:string, startedAt?:number}} init
 */
export function createTurn(init) {
  /** @type {Turn} */
  const turn = {
    id: init.id,
    index: init.index,
    model: init.model || {},
    agent: init.agent,
    provider: init.model?.provider,
    startedAt: init.startedAt || 0,
    endedAt: null,
    durationMs: null,
    status: Status.RUNNING,
    usage: emptyUsage(),
    events: [],
    error: undefined,
    prompt: undefined,
  };
  let seq = 0;
  return {
    turn,
    /** @param {string} type @param {number} at @param {object} [data] */
    push(type, at, data) {
      turn.events.push({ seq: seq++, type, at, ...(data ? { data } : {}) });
      return turn.events[turn.events.length - 1];
    },
    done({ status, endedAt } = {}) {
      turn.endedAt = endedAt ?? turn.events.at(-1)?.at ?? turn.startedAt;
      turn.durationMs = Math.max(0, turn.endedAt - turn.startedAt);
      turn.status = status || turn.status;
      return turn;
    },
  };
}
