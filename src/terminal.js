/**
 * terminal.js — 读取 Windows Terminal 当前选中的标签页。
 *
 * 已支持：
 *   pi       标签名形如 `π - <session name> - <user>`
 *   opencode 标签名形如 `OC | <session title>`
 *
 * 使用一个常驻 PowerShell worker：UIAutomation 只加载一次，每 2 秒查询一次 tab。
 * 若 worker 长时间无输出（UIA 卡住），看门狗会杀掉并重启它。
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const IS_WIN = platform() === 'win32';
const POLL_MS = 2_000;
const STALE_MS = 15_000;
const WATCHDOG_MS = 12_000;

const PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
while ($true) {
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $allPi = @()
  $allOc = @()
  $selPi = @()
  $selOc = @()
  foreach ($w in $wins) {
    try {
      if ($w.Current.Name -eq 'Terminal') {
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
        $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
        foreach ($t in $tabs) {
          $n = $t.Current.Name
          if (-not $n) { continue }
          $selected = $false
          try {
            $p = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
            $selected = $p.Current.IsSelected
          } catch {}
          if ([int][char]$n[0] -eq 0x03C0 -and $n -match '^.\s*-\s*(.*?)(?:\s*-\s*[^-]+)?$') {
            $name = $matches[1].Trim()
            if ($name) { $allPi += $name; if ($selected) { $selPi += $name } }
          } elseif ($n -match '^OC\s*\|\s*(.+)$') {
            $title = $matches[1].Trim()
            if ($title) { $allOc += $title; if ($selected) { $selOc += $title } }
          }
        }
      }
    } catch {}
  }
  $pi = if ($selPi.Count -gt 0) { $selPi } else { $allPi }
  $oc = if ($selOc.Count -gt 0) { $selOc } else { $allOc }
  $obj = @{ pi = @($pi | Select-Object -Unique); oc = @($oc | Select-Object -Unique) }
  $json = $obj | ConvertTo-Json -Depth 3 -Compress
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

let cached = { pi: '', oc: [], at: 0 };
let child = null;
let started = false;
let stopped = false;
let restartTimer = null;
let watchdogTimer = null;
let buf = '';

function clearWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = null;
}

function armWatchdog() {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    if (child && !stopped) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  }, WATCHDOG_MS);
  watchdogTimer.unref?.();
}

function handleLine(line) {
  const text = line.trim();
  if (!text) return;
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
    let data;
    try {
      data = JSON.parse(decoded);
    } catch {
      data = { pi: decoded, oc: [] };
    }
    const piRaw = Array.isArray(data.pi) ? data.pi[0] : data.pi;
    const ocRaw = Array.isArray(data.oc) ? data.oc : data.oc ? [data.oc] : [];
    cached = {
      pi: typeof piRaw === 'string' ? piRaw.trim() : '',
      oc: ocRaw.map((x) => String(x || '').trim()).filter(Boolean),
      at: Date.now(),
    };
    armWatchdog();
  } catch {
    // ignore malformed worker output
  }
}

function scheduleRestart(delay) {
  if (stopped || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    start();
  }, delay);
  restartTimer.unref?.();
}

function start() {
  if (!IS_WIN || stopped || child) return;
  buf = '';
  child = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  });

  child.on('exit', () => {
    child = null;
    clearWatchdog();
    scheduleRestart(1_500);
  });
  child.on('error', () => {
    child = null;
    clearWatchdog();
    scheduleRestart(3_000);
  });
  armWatchdog();
}

export function startTerminalWatcher() {
  if (!IS_WIN || started) return;
  started = true;
  start();
}

/** 当前 pi 标签页里的会话名；无则返回 ''。 */
export function getPiSessionName() {
  if (Date.now() - cached.at > STALE_MS) return '';
  return cached.pi;
}

/** 当前选中的 opencode 标签页标题；无则返回 []。 */
export function getOpencodeSessionNames() {
  if (Date.now() - cached.at > STALE_MS) return [];
  return cached.oc;
}

process.on('exit', () => {
  stopped = true;
  clearWatchdog();
  if (restartTimer) clearTimeout(restartTimer);
  child?.kill();
});
