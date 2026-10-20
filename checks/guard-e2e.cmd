@echo off
rem Entry point for the weekly guard-e2e run (Windows Task Scheduler). See guard-e2e.js for the Japanese notes.
rem Comments here must stay ASCII: cmd.exe reads this file as Shift-JIS (see health-check.cmd).
rem guard-e2e.js appends one line per run to guard-e2e.log; health-check.js reads that line every day.
node "%~dp0guard-e2e.js" >> "%~dp0schtasks-guard-e2e.log" 2>&1
echo [%date% %time%] exit=%errorlevel% >> "%~dp0schtasks-guard-e2e.log"
