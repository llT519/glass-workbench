@echo off
cd /d "%~dp0"
echo ============================================
echo   Glass Workbench - starting local server...
echo ============================================
where python >nul 2>nul
if %errorlevel%==0 (
  python -c "import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.connect(('8.8.8.8',80));print('  PC       : http://localhost:8765/index.html');print('  Phone(WiFi): http://%s:8765/index.html' % s.getsockname()[0])"
  start "" http://localhost:8765/index.html
  python -m http.server 8765
  goto :eof
)
where node >nul 2>nul
if %errorlevel%==0 (
  echo   PC: http://localhost:8765/index.html
  start "" http://localhost:8765/index.html
  npx --yes http-server -p 8765 -c-1 --silent
  goto :eof
)
echo   [ERROR] Python or Node.js not found. Please install one of them first.
pause
