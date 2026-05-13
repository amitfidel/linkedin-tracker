@echo off
REM Daily client-signal watch — runs Mon-Fri 9:00 AM via Windows Task Scheduler
REM Logs output to scripts/daily-watch.log

cd /d "C:\Users\amitf\Documents\Projects\personal progects\LinkedIn scraper\linkedin-tracker"

echo ======================================== >> scripts\daily-watch.log
echo %date% %time% - Starting daily watch >> scripts\daily-watch.log
echo ======================================== >> scripts\daily-watch.log

call npx tsx scripts/run-daily-watch.ts >> scripts\daily-watch.log 2>&1

echo %date% %time% - Finished >> scripts\daily-watch.log
echo. >> scripts\daily-watch.log
