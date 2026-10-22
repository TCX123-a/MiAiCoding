@echo off
rem ============================================================
rem  Contact sheet  /  drag a folder onto this file and drop it.
rem  NOTE: keep this file PURE ASCII. cmd.exe reads .bat files
rem  using the OEM codepage (GBK on a Chinese Windows), so any
rem  UTF-8 Chinese text in here turns into garbage. All Chinese
rem  messages live in contact_sheet.py, which controls its own
rem  stdout encoding.
rem ============================================================
chcp 65001 >nul
title Contact Sheet

if "%~1"=="" (
    python "%~dp0contact_sheet.py"
) else (
    python "%~dp0contact_sheet.py" %*
)

echo.
pause
