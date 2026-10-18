@echo off
cd /d "%~dp0.."
set "PORT=5517"
set "TT_EXIT_ON_CLIENT_CLOSE=1"

start "thinktree" /min node src\server\index.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:5517"
