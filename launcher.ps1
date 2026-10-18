param([switch]$Status, [switch]$Preview)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Port = 5517
$Url = "http://localhost:$Port"
$LogDir = Join-Path $Root 'logs'
$OutLog = Join-Path $LogDir 'server.out.log'
$ErrLog = Join-Path $LogDir 'server.err.log'

function Get-ServerPid {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  return $null
}

function Get-DisplayWidth([string]$Text) {
  $w = 0
  foreach ($ch in $Text.ToCharArray()) {
    if ([int]$ch -gt 0x2E80) { $w += 2 } else { $w += 1 }
  }
  return $w
}

function Pad-Display([string]$Text, [int]$Width) {
  return $Text + (' ' * [Math]::Max(1, $Width - (Get-DisplayWidth $Text)))
}

function Start-Browser {
  $edge = $null
  $chrome = $null
  if (${env:ProgramFiles(x86)}) {
    $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  }
  if ($env:ProgramFiles) {
    $chrome = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
  }
  if ($edge -and (Test-Path $edge)) {
    $profile = Join-Path $env:LOCALAPPDATA 'thinktree\edge'
    $browserArgs = "--user-data-dir=""$profile"" --no-first-run --no-default-browser-check --start-fullscreen $Url"
    Start-Process -FilePath $edge -ArgumentList $browserArgs
    return
  }
  if ($chrome -and (Test-Path $chrome)) {
    $profile = Join-Path $env:LOCALAPPDATA 'thinktree\chrome'
    $browserArgs = "--user-data-dir=""$profile"" --no-first-run --no-default-browser-check --start-fullscreen $Url"
    Start-Process -FilePath $chrome -ArgumentList $browserArgs
    return
  }
  Start-Process $Url
}

function Test-BrowserOpen {
  $list = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue
  foreach ($p in $list) {
    if ($p.CommandLine -and $p.CommandLine -like '*thinktree\edge*') { return $true }
    if ($p.CommandLine -and $p.CommandLine -like '*thinktree\chrome*') { return $true }
  }
  return $false
}

function Start-Server {
  if (Get-ServerPid) { return $false }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '找不到 node，请先安装 Node.js'
  }
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $env:PORT = "$Port"
  $env:TT_EXIT_ON_CLIENT_CLOSE = '1'
  Start-Process -FilePath 'node' `
    -ArgumentList 'src/server/index.js' `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog | Out-Null
  Start-Sleep -Milliseconds 1600
  return $true
}

function Stop-Server {
  $serverPid = Get-ServerPid
  if (-not $serverPid) { return $false }
  & taskkill.exe /PID $serverPid /T /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 600
  return $true
}

function Show-Header {
  $running = [bool](Get-ServerPid)
  $state = if ($running) { '[运行中]' } else { '[未运行]' }
  $left = "  后端 :$Port  $state"
  $right = "前端 :内置静态  $state"
  Write-Host ''
  Write-Host (Pad-Display $left 40) -NoNewline
  Write-Host $right
  Write-Host ''
  Write-Host ('-' * 76)
}

function Show-Menu {
  Show-Header
  Write-Host '  [1]' -ForegroundColor DarkGray -NoNewline; Write-Host '  启动服务（并全屏打开浏览器）'
  Write-Host '  [2]' -ForegroundColor DarkGray -NoNewline; Write-Host '  停止服务'
  Write-Host '  [3]' -ForegroundColor DarkGray -NoNewline; Write-Host '  刷新状态'
  Write-Host '  [4]' -ForegroundColor DarkGray -NoNewline; Write-Host '  打开浏览器'
  Write-Host ''
  Write-Host '  [5]' -ForegroundColor DarkGray -NoNewline; Write-Host '  查看日志（末 20 行）'
  Write-Host '  [6]' -ForegroundColor DarkGray -NoNewline; Write-Host '  清空日志'
  Write-Host ''
  Write-Host '  [0]' -ForegroundColor DarkGray -NoNewline; Write-Host '  退出（会停止服务）'
  Write-Host ('-' * 76)
  Write-Host '  关闭浏览器后，服务会自动停止。' -ForegroundColor DarkGray
}

function Show-Logs {
  Clear-Host
  Write-Host '服务日志（末 20 行）'
  Write-Host ('-' * 76)
  $lines = @()
  if (Test-Path $OutLog) { $lines += Get-Content -LiteralPath $OutLog -Tail 20 -ErrorAction SilentlyContinue }
  if (Test-Path $ErrLog) { $lines += Get-Content -LiteralPath $ErrLog -Tail 20 -ErrorAction SilentlyContinue }
  if ($lines.Count -eq 0) {
    Write-Host '(暂无日志)' -ForegroundColor DarkGray
  } else {
    $lines | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
  }
  Write-Host ''
  Read-Host '回车返回' | Out-Null
}

function Clear-Logs {
  try {
    if (Test-Path $OutLog) { Clear-Content -LiteralPath $OutLog -ErrorAction Stop }
    if (Test-Path $ErrLog) { Clear-Content -LiteralPath $ErrLog -ErrorAction Stop }
    Write-Host '日志已清空。' -ForegroundColor DarkGray
  } catch {
    Write-Host '服务运行中，日志被占用；请先停止服务再清空。' -ForegroundColor DarkGray
  }
  Start-Sleep -Milliseconds 900
}

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null
  $Host.UI.RawUI.WindowTitle = 'thinktree'
} catch {}

if ($Status) {
  $running = [bool](Get-ServerPid)
  Write-Output ("server={0} port={1} browser={2}" -f $running, $Port, (Test-BrowserOpen))
  exit 0
}

if ($Preview) {
  Show-Menu
  exit 0
}

while ($true) {
  Clear-Host
  Show-Menu
  $choice = (Read-Host '请选择').Trim()
  $quit = $false

  switch ($choice) {
    '1' {
      try {
        if (Start-Server) {
          if (-not (Test-BrowserOpen)) { Start-Browser }
        } else {
          Write-Host '服务已在运行。' -ForegroundColor DarkGray
        }
      } catch {
        Write-Host $_.Exception.Message -ForegroundColor DarkGray
      }
      Start-Sleep -Milliseconds 900
    }
    '2' {
      if (Stop-Server) { Write-Host '服务已停止。' -ForegroundColor DarkGray }
      else { Write-Host '服务未运行。' -ForegroundColor DarkGray }
      Start-Sleep -Milliseconds 700
    }
    '3' { }
    '4' { Start-Browser; Start-Sleep -Milliseconds 700 }
    '5' { Show-Logs }
    '6' { Clear-Logs }
    '0' {
      Stop-Server | Out-Null
      $quit = $true
    }
    default {
      if ($choice) { Start-Sleep -Milliseconds 300 }
    }
  }
  if ($quit) { break }
}
