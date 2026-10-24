@echo off
rem Project-Trace launcher for Windows. Double-click me.
title Project-Trace
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Project-Trace needs Node.js ^(free^). Opening the download page...
  echo  Install the "LTS" version, then double-click this file again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo.
  echo  First run: installing Project-Trace ^(about a minute, needs internet^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  Installation failed - see the messages above.
    pause
    exit /b 1
  )
)

echo  Starting Project-Trace...
call npm start
if errorlevel 1 pause
