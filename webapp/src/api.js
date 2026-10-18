/** 后端 API 客户端：只经 HTTP，不直接读文件/进程。 */

export async function fetchAgents() {
  const r = await fetch('/api/agents');
  if (!r.ok) throw new Error(`agents ${r.status}`);
  return r.json();
}

export async function fetchSession(sourceId, id) {
  const r = await fetch(`/api/session/${encodeURIComponent(sourceId)}/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`session ${r.status}`);
  return r.json();
}

/**
 * SSE 流：
 *   event: agents   存活 agent + 活会话摘要
 *   event: session  归一化会话（含 turns/events）
 */
export function openStream({ onAgents, onSession, onStatus } = {}) {
  const es = new EventSource('/api/stream');
  es.addEventListener('agents', (e) => onAgents?.(JSON.parse(e.data)));
  es.addEventListener('session', (e) => onSession?.(JSON.parse(e.data)));
  es.onopen = () => onStatus?.('open');
  es.onerror = () => onStatus?.('error');
  return es;
}
