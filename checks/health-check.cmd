@echo off
rem Entry point for Windows Task Scheduler. See health-check.js for the Japanese notes.
rem Comments here must stay ASCII: cmd.exe reads this file as Shift-JIS, so UTF-8
rem Japanese comments break into invalid commands (measured: exit=9009).
rem No absolute paths: node comes from PATH, the script from %~dp0 (this file's folder).
node "%~dp0health-check.js" >> "%~dp0schtasks.log" 2>&1
echo [%date% %time%] exit=%errorlevel% >> "%~dp0schtasks.log"
