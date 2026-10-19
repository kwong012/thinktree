/** 源适配器共用工具。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { findProcesses } from '../proc.js';

/**
 * 统一判定「存活」：
 *   进程（名字或命令行）匹配，或最近 recentWindow 内仍有会话写入
 *   （npm 安装的 CLI 常以 node 运行，命令行匹配不到时用活跃度兜底）。
 */
export function pickLive(procSnapshot, patterns, sessions, opts = {}) {
  const { aliveWindow = 30 * 60_000, recentWindow = 90_000 } = opts;
  const processes = findProcesses(procSnapshot?.processes || [], patterns);
  const now = Date.now();
  const newest = sessions[0]?.updatedAt || 0;
  const recent = newest > 0 && now - newest <= recentWindow;
  if (!processes.length && !recent) return { processes: [], sessions: [] };

  const ordered = preferCwd(sessions, processes);
  const norm = (v) => String(v || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const activeNames = (opts.activeNames || []).map(normName).filter(Boolean);

  // 终端 tab 是“当前会话”的最快信号：优先于 cwd / updatedAt 推断。
  if (activeNames.length) {
    const namesOf = (s) => [s.name, s.title].map(normName).filter(Boolean);
    const take = (predicate) => {
      const seen = new Set();
      return sessions
        .filter((s) => {
          if (seen.has(s.id)) return false;
          if (!namesOf(s).some(predicate)) return false;
          seen.add(s.id);
          return true;
        })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    };
    let active = take((n) => activeNames.includes(n));
    if (!active.length) {
      active = take((n) =>
        activeNames.some(
          (a) => Math.min(n.length, a.length) >= 4 && (n.startsWith(a) || a.startsWith(n)),
        ),
      );
    }
    if (active.length) return { processes, sessions: active };
  }

  const allCwds = new Set(processes.map((p) => norm(p.cwd)).filter(Boolean));
  const focusedPid = procSnapshot?.focused?.pid;
  const focusedProc = focusedPid ? processes.find((p) => p.pid === focusedPid) : null;
  const focusedCwd = focusedProc ? norm(focusedProc.cwd) : '';

  const latestPerCwd = (dirs) => {
    const byDir = new Map();
    for (const s of ordered) {
      const dir = norm(s.directory);
      if (!dirs.has(dir)) continue;
      const prev = byDir.get(dir);
      if (!prev || (s.updatedAt || 0) > (prev.updatedAt || 0)) byDir.set(dir, s);
    }
    return [...byDir.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  };

  // 聚焦进程的 cwd 优先；没有聚焦时合并该 agent 所有存活进程的 cwd。
  // 每个 cwd 只取最新会话，代表该存活进程当前会话，不展开历史。
  let matched = focusedCwd ? latestPerCwd(new Set([focusedCwd])) : latestPerCwd(allCwds);
  if (!matched.length && focusedCwd && allCwds.size) matched = latestPerCwd(allCwds);

  if (matched.length) return { processes, sessions: matched };

  return {
    processes,
    sessions: ordered.filter((s, i) => i === 0 || now - s.updatedAt <= aliveWindow),
  };
}

export function safeJson(str, fallback = {}) {
  if (str == null) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readFirstLine(path) {
  try {
    const buf = readFileSync(path);
    const nl = buf.indexOf(0x0a);
    const end = nl >= 0 ? nl : Math.min(buf.length, 8192);
    return buf.subarray(0, end).toString('utf8').replace(/\r$/, '');
  } catch {
    return '';
  }
}

/** 读取 JSONL（可限制只读末尾 maxBytes，用于超大活跃文件）。 */
export function readJsonl(path, maxBytes) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  if (maxBytes && text.length > maxBytes) {
    text = text.slice(text.length - maxBytes);
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      // 忽略半行/坏行
    }
  }
  return out;
}

/** 递归列出文件（同步，适合本地小目录树）。 */
export function walkFiles(dir, filter = () => true, depth = 8) {
  const out = [];
  const visit = (d, level) => {
    if (level > depth) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) visit(p, level + 1);
      else if (filter(p)) out.push(p);
    }
  };
  visit(dir, 0);
  return out;
}

export function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function usageOf(u = {}) {
  return {
    input: u.input || 0,
    output: u.output || 0,
    reasoning: u.reasoning || 0,
    cacheRead: u.cacheRead || 0,
    cacheWrite: u.cacheWrite || 0,
    cost: typeof u.cost === 'number' ? u.cost : u.cost?.total || 0,
  };
}

export function timeMs(v) {
  if (typeof v === 'number') return v;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

/** 从字符串或内容块数组提取文本。 */
export function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (typeof c === 'string' ? c : c?.text || c?.thinking || c?.content || ''))
    .filter(Boolean)
    .join('\n');
}

export function dirName(p) {
  if (!p) return '';
  try {
    return basename(String(p).replace(/[\\/]+$/, ''));
  } catch {
    return '';
  }
}

export function shortId(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
}

/**
 * CLI/TUI 优先：把与进程 cwd 匹配的会话排到最前（桌面端不调用）。
 */
export function preferCwd(sessions, processes) {
  const norm = (v) => String(v || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  const cwds = new Set((processes || []).map((p) => norm(p.cwd)).filter(Boolean));
  if (!cwds.size) return sessions;
  const match = sessions.filter((s) => cwds.has(norm(s.directory)));
  if (!match.length) return sessions;
  const ids = new Set(match.map((s) => s.id));
  return [...match, ...sessions.filter((s) => !ids.has(s.id))];
}
