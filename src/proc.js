/**
 * proc.js — 进程存活 + 前台窗口聚焦（Windows）
 * ------------------------------------------------
 * 启动一个**常驻 PowerShell worker**，每秒输出一行 base64(JSON)：
 *   { focused: {pid,name,title}, processes: [{pid,name}] }
 *
 * 用 base64 传输，彻底避开 PowerShell 控制台编码（GBK/UTF8）导致的乱码。
 * 用常驻 worker（而非每次 spawn）避免反复 Add-Type 编译的开销。
 *
 * 非 Windows 平台返回空快照，保证可运行。
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const IS_WIN = platform() === 'win32';

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TTWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
while ($true) {
  $fg = [TTWin32]::GetForegroundWindow()
  $fpid = [uint32]0
  [void][TTWin32]::GetWindowThreadProcessId($fg, [ref]$fpid)
  $sb = New-Object System.Text.StringBuilder 512
  [void][TTWin32]::GetWindowText($fg, $sb, 512)
  $fname = ""
  try { $fname = (Get-Process -Id $fpid -ErrorAction Stop).ProcessName } catch {}
  $cmds = @{}
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe' OR Name='pythonw.exe' OR Name='bun.exe' OR Name='deno.exe'" |
      ForEach-Object { $cmds[[int]$_.ProcessId] = $_.CommandLine }
  } catch {}
  $procs = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { @{ pid = $_.Id; name = $_.ProcessName; cmd = $cmds[[int]$_.Id] } })
  $obj = @{ focused = @{ pid = [int]$fpid; name = $fname; title = $sb.ToString() }; processes = $procs }
  $json = $obj | ConvertTo-Json -Depth 4 -Compress
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
  Start-Sleep -Milliseconds 1000
}
`;

/** @typedef {{pid:number,name:string,title?:string}} Focused */
/** @typedef {{pid:number,name:string}} Proc */
/** @typedef {{focused:Focused|null, processes:Proc[], at:number}} ProcSnapshot */

export function createProcMonitor() {
  /** @type {ProcSnapshot} */
  let snapshot = { focused: null, processes: [], at: 0 };
  let child = null;
  let stopped = false;
  let restartTimer = null;
  let buf = '';

  function start() {
    if (!IS_WIN || stopped) return;
    child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(Buffer.from(line, 'base64').toString('utf8'));
          snapshot = {
            focused: obj.focused?.name ? obj.focused : null,
            processes: (obj.processes || []).map((p) => ({ pid: p.pid, name: p.name, cmd: p.cmd })),
            at: Date.now(),
          };
        } catch {
          // 单行解析失败忽略
        }
      }
    });

    child.on('exit', () => {
      child = null;
      if (!stopped) restartTimer = setTimeout(start, 1500);
    });
    child.on('error', () => {
      child = null;
      if (!stopped) restartTimer = setTimeout(start, 3000);
    });
  }

  start();

  return {
    /** 最新快照（同步，O(1)）。 */
    get() {
      return snapshot;
    },
    /** 是否在最近的活跃窗口内收到过数据。 */
    isFresh(maxAgeMs = 4000) {
      return Date.now() - snapshot.at <= maxAgeMs;
    },
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      child?.kill();
      child = null;
    },
  };
}

/** 名字或命令行是否匹配任一模式（RegExp 或字符串）。 */
export function matchesProcess(processes, patterns) {
  return processes.some((p) =>
    patterns.some((pat) =>
      pat instanceof RegExp ? pat.test(p.name) || pat.test(p.cmd || '') : p.name === pat,
    ),
  );
}

/** 取出匹配到的进程列表（支持按命令行匹配 npm 安装的 CLI）。 */
export function findProcesses(processes, patterns) {
  return processes.filter((p) =>
    patterns.some((pat) =>
      pat instanceof RegExp ? pat.test(p.name) || pat.test(p.cmd || '') : p.name === pat,
    ),
  );
}
