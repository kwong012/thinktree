#!/usr/bin/env node
/**
 * Dev utility: dump a normalized trace for one opencode session.
 *   node scripts/dump-trace.mjs                 # latest session, summary
 *   node scripts/dump-trace.mjs <sessionId>     # that session
 *   node scripts/dump-trace.mjs <sessionId> -v  # full event payloads
 */
import { createOpencodeAdapter, classifyTool } from '../src/adapters/opencode.js';
import { mcpServerNames } from '../src/adapters/opencode-config.js';
import { modelLabel } from '../src/schema/trace.js';

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const idArg = args.find((a) => !a.startsWith('-'));

const mcp = mcpServerNames();
const adapter = createOpencodeAdapter({ mcpServers: mcp });

console.log(`# MCP servers: ${mcp.join(', ') || '(none)'}`);

const sessions = adapter.listSessions({ limit: 10 });
if (!idArg) {
  console.log(`\n# Recent sessions (${sessions.length}):`);
  for (const s of sessions) {
    console.log(`  ${s.id}  [${s.agent}] ${modelLabel(s.model)}  ${trunc(s.title, 40)}  (${fmtTime(s.updatedAt)})`);
  }
}

const id = idArg || sessions[0]?.id;
if (!id) process.exit(0);

const sess = adapter.getSession(id);
console.log(`\n# Session ${sess.id}`);
console.log(`  title   : ${sess.title}`);
console.log(`  agent   : ${sess.agent}`);
console.log(`  model   : ${modelLabel(sess.model)}`);
console.log(`  dir     : ${sess.directory}`);
console.log(`  worktree: ${sess.worktree}`);
console.log(`  usage   : ${JSON.stringify(sess.usage)}`);
console.log(`  turns   : ${sess.turns.length}`);

for (const t of sess.turns) {
  console.log(`\n┌─ Turn #${t.index}  [${t.agent}] ${modelLabel(t.model)}  ${t.status}  ${t.durationMs}ms`);
  console.log(`│  prompt: ${trunc(t.prompt || '', 100)}`);
  for (const e of t.events) {
    const d = e.data || {};
    let line;
    switch (e.type) {
      case 'prompt': line = `user: ${trunc(d.text, 80)}`; break;
      case 'context': line = `ctx(${d.source})${d.instructionSources?.length ? ' [' + d.instructionSources.join(',') + ']' : ''}: ${trunc(d.text, 70)}`; break;
      case 'reasoning': line = `think: ${trunc(d.text, 90)}`; break;
      case 'answer': line = `answer: ${trunc(d.text, 90)}`; break;
      case 'tool-call': line = `→ tool ${d.name} ${d.kind === 'mcp' ? `(mcp:${d.server})` : ''} ${trunc(JSON.stringify(d.input), 70)}`; break;
      case 'tool-result': line = `← ${d.name} ${d.status} ${d.durationMs ?? '?'}ms: ${trunc(d.output, 60)}`; break;
      case 'step': line = `step ${d.finish || d.reason}: in=${d.usage.input} out=${d.usage.output} think=${d.usage.reasoning} cache=${d.usage.cacheRead} $${d.usage.cost.toFixed(5)}`; break;
      case 'switch': line = `switch ${d.kind}: ${d.kind === 'model' ? modelLabel(d.from) + ' -> ' + modelLabel(d.to) : d.from + ' -> ' + d.to}`; break;
      case 'status': line = `status: ${d.outcome}`; break;
      default: line = `${d.kind || ''} ${trunc(JSON.stringify(d), 60)}`;
    }
    console.log(`│  ${String(e.seq).padStart(3)} ${fmtTime(e.at)} ${e.type.padEnd(11)} ${line}`);
    if (verbose && (e.type === 'reasoning' || e.type === 'answer')) console.log(`│      ${d.text}`);
  }
  console.log(`└  usage: in=${t.usage.input} out=${t.usage.output} think=${t.usage.reasoning} cache=${t.usage.cacheRead} $${t.usage.cost.toFixed(5)}`);
}

function trunc(s, n) { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
function fmtTime(ms) { return ms ? new Date(ms).toISOString().slice(11, 19) : '--:--:--'; }
