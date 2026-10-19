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
import { getOpencodeSessionNames, startTerminalWatcher } from '../terminal.js';
import { pickLive, preferCwd } from './util.js';

const PROCESS_PATTERNS = [/^opencode/i];

export function createOpencodeSource({ aliveWindowMs = 30 * 60_000 } = {}) {
  startTerminalWatcher();
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
      const activeNames = getOpencodeSessionNames();
      // 补查标题匹配的会话，避免当前会话不在最近 100 个创建记录里。
      const all = adapter.listSessions({ limit: 100, titles: activeNames });
      const live = pickLive(procSnapshot, PROCESS_PATTERNS, all, {
        aliveWindow: aliveWindowMs,
        activeNames,
      });
      live.sessions = preferCwd(live.sessions, live.processes);
      return live;
    },

    getSession: adapter.getSession,
    listSessions: adapter.listSessions,
  };
}
