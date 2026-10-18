/**
 * opencode 源
 * -----------
 * 把底层读取器（adapters/opencode.js）包装成「源」接口：
 *   - processPatterns   用于进程存活判定
 *   - listLive(proc)     返回该源当前存活的会话
 *   - getSession(id)     归一化会话（含 turns/events）
 */
import { createOpencodeAdapter } from '../adapters/opencode.js';
import { mcpServerNames } from '../adapters/opencode-config.js';
import { findProcesses } from '../proc.js';

const PROCESS_PATTERNS = [/^opencode/i];

export function createOpencodeSource({ aliveWindowMs = 30 * 60_000 } = {}) {
  const mcpServers = mcpServerNames();
  const adapter = createOpencodeAdapter({ mcpServers });

  return {
    id: 'opencode',
    name: 'opencode',
    interface: 'cli/tui',
    description: 'opencode 会话数据库（session_v2 / session_message）',
    available: true,
    processPatterns: PROCESS_PATTERNS,

    listLive(procSnapshot) {
      const processes = findProcesses(procSnapshot?.processes || [], PROCESS_PATTERNS);
      if (!processes.length) return { processes: [], sessions: [] };

      const all = adapter.listSessions({ limit: 100 });
      const now = Date.now();
      // 进程存活时：展示最近会话 + 活跃窗口内更新过的会话。
      const sessions = all.filter((s, i) => i === 0 || (s.updatedAt && now - s.updatedAt <= aliveWindowMs));
      return { processes, sessions };
    },

    getSession: adapter.getSession,
    listSessions: adapter.listSessions,
  };
}
