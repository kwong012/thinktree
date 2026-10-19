/**
 * terminal.js — 读取 Windows Terminal 当前选中的标签页。
 *
 * 已支持：
 *   pi       标签名形如 `π - <session name> - <user>`
 *   opencode 标签名形如 `OC | <session title>`
 *
 * UIA 查询较重，因此后台每 2 秒轮询一次并缓存；读取时同步取缓存。
 */
import { execFile } from 'node:child_process';

const PS = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
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
`;

let cached = { pi: '', oc: [], at: 0 };
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
        const decoded = Buffer.from(stdout.trim(), 'base64').toString('utf8').trim();
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
      } catch {
        // ignore
      }
    },
  );
}

export function startTerminalWatcher() {
  if (process.platform !== 'win32' || timer) return;
  poll();
  timer = setInterval(poll, 2000);
  timer.unref?.();
}

/** 当前 pi 标签页里的会话名；无则返回 ''。 */
export function getPiSessionName() {
  if (Date.now() - cached.at > 15_000) return '';
  return cached.pi;
}

/** 当前选中的 opencode 标签页标题；无则返回 []。 */
export function getOpencodeSessionNames() {
  if (Date.now() - cached.at > 15_000) return [];
  return cached.oc;
}
