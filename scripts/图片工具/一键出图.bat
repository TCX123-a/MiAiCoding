@echo off
rem ============================================================
rem  Double-click this to generate every mascot image the app
rem  needs: batch text-to-image -> cut out the white background
rem  -> build one numbered contact sheet per pose.
rem
rem  Extra arguments are passed straight through to gen_mascot.py,
rem  e.g. from a cmd window in this folder:
rem      this-file.bat --pose busy --limit 3
rem
rem  NOTE: keep the CONTENTS of this file PURE ASCII. cmd.exe
rem  reads .bat files using the OEM codepage (GBK on a Chinese
rem  Windows), so UTF-8 Chinese text in here turns into garbage
rem  and breaks the commands. All Chinese messages live in the
rem  .py files, which control their own stdout encoding.
rem  (The FILE NAME may be Chinese - that is stored as UTF-16
rem   in the directory entry and is not affected by this.)
rem ============================================================
title MiAi Mascot Generator
cd /d "%~dp0"

python "%~dp0gen_mascot.py" %*
set RC=%ERRORLEVEL%

echo.
if not "%RC%"=="0" echo [FAILED] exit code %RC% - read the messages above.
pause >nul
