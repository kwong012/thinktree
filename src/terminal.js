/**
 * terminal.js — 从 Windows Terminal 标签页读取 pi 的当前会话名。
 *
 * pi 会把标签页标题设为 `π - <session name> - <user>`。
 * UIA 查询较重，因此后台每 3 秒轮询一次并缓存；读取时同步取缓存。
 */
import { execFile } from 'node:child_process';

const PS = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$name = ''
foreach ($w in $wins) {
  try {
    if ($w.Current.Name -eq 'Terminal') {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
      $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      foreach ($t in $tabs) {
        $n = $t.Current.Name
        if ($n.Length -gt 0 -and [int][char]$n[0] -eq 0x03C0 -and $n -match '^.\s*-\s*(.*?)(?:\s*-\s*[^-]+)?$') {
          $name = $matches[1]
          break
        }
      }
    }
  } catch {}
}
[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($name)))
`;

let cachedName = '';
let cachedAt = 0;
let timer = null;
let running = false;

function poll() {
  if (running) return;
  running = true;
  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS],
    { windowsHide: true, timeout: 6000 },
    (err, stdout) => {
      running = false;
      if (err || !stdout) return;
      try {
        const name = Buffer.from(stdout.trim(), 'base64').toString('utf8').trim();
        if (name) {
          cachedName = name;
          cachedAt = Date.now();
        }
      } catch {
        // ignore
      }
    },
  );
}

export function startTerminalWatcher() {
  if (process.platform !== 'win32' || timer) return;
  poll();
  timer = setInterval(poll, 3000);
  timer.unref?.();
}

/** 当前 pi 标签页里的会话名；无则返回 ''。 */
export function getPiSessionName() {
  if (Date.now() - cachedAt > 15_000) return '';
  return cachedName;
}
