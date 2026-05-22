@echo off
title CIQ Dashboard
cd /d "%~dp0"
start "" http://localhost:5173
npm run dev
