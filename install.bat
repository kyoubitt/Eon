@echo off
rem Double-click this file to install Eon. It runs install.ps1 without asking about script policy.
title Installing Eon
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
