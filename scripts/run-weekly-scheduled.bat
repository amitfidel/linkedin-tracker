@echo off
REM Weekly LinkedIn scrape — runs every Monday at 2:00 AM via Windows Task Scheduler
REM Logs output to scripts/weekly-scrape.log

cd /d "C:\Users\amitf\Documents\Projects\personal progects\LinkedIn scraper\linkedin-tracker"

echo ======================================== >> scripts\weekly-scrape.log
echo %date% %time% - Starting weekly scrape >> scripts\weekly-scrape.log
echo ======================================== >> scripts\weekly-scrape.log

call npx tsx scripts/run-weekly-scrape.ts >> scripts\weekly-scrape.log 2>&1

echo %date% %time% - Finished >> scripts\weekly-scrape.log
echo. >> scripts\weekly-scrape.log
