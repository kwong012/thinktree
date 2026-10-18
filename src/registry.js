/**
 * registry.js — 汇总所有源，产出「活会话」快照
 * ------------------------------------------------
 * 只返回**存活**的 agent（进程存活）；按「聚焦优先 → 最近活跃倒序」排序。
 */
import { createProcMonitor } from './proc.js';
import { createSources } from './sources/index.js';

export function createRegistry() {
  const proc = createProcMonitor();
  const sources = createSources();
  const byId = new Map(sources.map((s) => [s.id, s]));

  function lastActive(agent) {
    return agent.sessions.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0);
  }

  /** @returns {{at:number, focused:object|null, agents:object[]}} */
  function snapshot() {
    const p = proc.get();

    const agents = sources
      .map((src) => {
        const { processes, sessions } = src.listLive(p);
        const focused = !!p.focused && processes.some((pr) => pr.pid === p.focused.pid);
        return {
          sourceId: src.id,
          name: src.name,
          interface: src.interface,
          description: src.description,
          available: src.available,
          alive: processes.length > 0,
          focused,
          processes,
          sessions,
        };
      })
      .filter((a) => a.alive && a.sessions.length > 0);

    agents.sort((a, b) => Number(b.focused) - Number(a.focused) || lastActive(b) - lastActive(a));

    return { at: Date.now(), focused: p.focused, agents };
  }

  return {
    proc,
    sources,
    snapshot,
    getSource(id) {
      return byId.get(id) || null;
    },
  };
}
