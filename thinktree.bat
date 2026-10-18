@echo off
setlocal
cd /d "%~dp0"
set "PORT=5517"
set "TT_EXIT_ON_CLIENT_CLOSE=1"
set "URL=http://localhost:5517"

start "thinktree" /min node src\server\index.js
timeout /t 2 /nobreak >nul

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE%" (
  start "" "%EDGE%" --user-data-dir="%LOCALAPPDATA%\thinktree\edge" --no-first-run --no-default-browser-check --start-fullscreen "%URL%"
  goto :done
)
if exist "%CHROME%" (
  start "" "%CHROME%" --user-data-dir="%LOCALAPPDATA%\thinktree\chrome" --no-first-run --no-default-browser-check --start-fullscreen "%URL%"
  goto :done
)
start "" "%URL%"

:done
endlocal
