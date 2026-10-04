@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Automaton - tableau de bord
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installez la version 22 : https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -v') do set NODEV=%%v
set NODEV=%NODEV:v=%
if %NODEV% GEQ 24 (
  echo ATTENTION : vous utilisez Node %NODEV%. Le projet marche avec Node 22.
  echo Tapez : nvm use 22.22.0   puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Premiere installation, patientez un instant...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue. Copiez le message ci-dessus pour obtenir de l'aide.
    pause
    exit /b 1
  )
)

start "" http://127.0.0.1:4173
echo Tableau de bord : http://127.0.0.1:4173   (Ctrl+C pour arreter)
call npm run dashboard
pause
