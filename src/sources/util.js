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
  const cwds = new Set(processes.map((p) => norm(p.cwd)).filter(Boolean));
  const matched = new Set(ordered.filter((s) => cwds.has(norm(s.directory))).map((s) => s.id));

  // CLI/TUI：能按 cwd 定位时，只显示当前会话，不再列出历史会话。
  if (matched.size) return { processes, sessions: [ordered[0]] };

  return {
    processes,
    sessions: ordered.filter(
      (s, i) => i === 0 || matched.has(s.id) || now - s.updatedAt <= aliveWindow,
    ),
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
