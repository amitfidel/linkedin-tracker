@echo off
REM Scheduled Gartner scrape — runs every Monday at 10:00 AM via Windows Task Scheduler
REM Logs output to scripts/gartner-scrape.log

cd /d "C:\Users\amitf\Documents\Projects\personal progects\LinkedIn scraper\linkedin-tracker"

echo ======================================== >> scripts\gartner-scrape.log
echo %date% %time% - Starting Gartner scrape >> scripts\gartner-scrape.log
echo ======================================== >> scripts\gartner-scrape.log

call npx tsx scripts/run-gartner-local.ts >> scripts\gartner-scrape.log 2>&1

echo %date% %time% - Finished >> scripts\gartner-scrape.log
echo. >> scripts\gartner-scrape.log
