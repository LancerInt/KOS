@echo off
REM KOS daily due-reminder scan. Run by Windows Task Scheduler (task "KOS Due Reminders").
REM Generates + emails 7-day / 1-day / on-due / overdue reminders to each project creator.
cd /d "C:\Users\Lancer International\KOS\backend"
echo ---- %DATE% %TIME% ---- >> "_due_scan.log"
".venv\Scripts\python.exe" "manage.py" check_workspace_durations >> "_due_scan.log" 2>&1
