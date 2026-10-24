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

rem Installs (or re-installs, if the folder was copied from a Mac) the dependencies for this PC.
node scripts\ensure-install.mjs
if errorlevel 1 (
  echo.
  echo  Installation failed - see the messages above.
  pause
  exit /b 1
)

echo  Starting Project-Trace...
call npm start
if errorlevel 1 pause
