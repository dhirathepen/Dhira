@echo off
cd /d "C:\Users\mrmoh\OneDrive\Desktop\Websites\dhira\backend"
set DATABASE_FILE=data/dhira.sqlite
set ALLOWED_ORIGINS=
timeout 2 >nul
node server.js
