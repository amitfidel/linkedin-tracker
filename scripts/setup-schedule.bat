@echo off
REM Creates a Windows Task Scheduler entry to run the Gartner scrape every Monday at 10:00 AM
schtasks /create /tn "CyberTracker-GartnerScrape" /tr "C:\Users\amitf\Documents\Projects\personal progects\LinkedIn scraper\linkedin-tracker\scripts\run-gartner-scheduled.bat" /sc weekly /d MON /st 10:00 /f
if %errorlevel% equ 0 (
    echo Task created successfully! Gartner scrape will run every Monday at 10:00 AM.
    echo To verify: schtasks /query /tn "CyberTracker-GartnerScrape"
    echo To delete:  schtasks /delete /tn "CyberTracker-GartnerScrape" /f
) else (
    echo Failed to create task. Try running this script as Administrator.
)
REM pause
