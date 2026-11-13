@echo off
rem Daily clean-up (expired sessions/links, old closed inquiries, old email logs). See backend/README.md.
rem Needs PostgreSQL running (start-dev.cmd). Output is appended to backend\maintenance.log.
cd /d "%~dp0backend"
".venv\Scripts\python.exe" -m app.maintenance %* >> maintenance.log 2>&1
