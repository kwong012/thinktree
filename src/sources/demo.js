/**
 * Demo source — synthetic multi-turn session for screenshots and local preview.
 * Enabled only when TT_DEMO=1; it replaces real sources.
 */
import { buildDemoSessions } from '../../demo/demo-data.js';

function summary(session) {
  return {
    id: session.id,
    title: session.title,
    agent: session.agent,
    model: session.model,
    directory: session.directory,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function createDemoSource() {
  const sessions = buildDemoSessions();
  const main = sessions[0];

  return {
    id: 'demo',
    name: 'opencode',
    interface: 'cli/tui',
    description: 'Synthetic multi-turn demo session',
    available: true,
    processPatterns: [],

    listLive() {
      return { processes: [], sessions: main ? [summary(main)] : [] };
    },

    listSessions() {
      return sessions.map(summary);
    },

    getSession(id) {
      return sessions.find((session) => session.id === id) || null;
    },
  };
}
