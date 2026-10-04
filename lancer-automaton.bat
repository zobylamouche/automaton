@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Automaton - agent
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

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Installation de pnpm, necessaire pour compiler le projet...
  call npm install -g pnpm
  if errorlevel 1 (
    echo Impossible d'installer pnpm. Rouvrez ce fichier en administrateur.
    pause
    exit /b 1
  )
)
if not exist dist\index.js (
  echo Compilation du projet, cela prend une minute...
  call npm run build
  if errorlevel 1 (
    echo La compilation a echoue. Copiez le message ci-dessus pour obtenir de l'aide.
    pause
    exit /b 1
  )
)

echo Ouverture du tableau de bord dans une autre fenetre...
start "Automaton - tableau de bord" cmd /k "npm run dashboard"
timeout /t 4 >nul
start "" http://127.0.0.1:4173

echo.
echo ============================================================
echo  L'agent depense de l'argent reel.
echo  Au premier lancement, baissez les limites de depense :
echo    transfert max 500, par heure 1000, par jour 2000,
echo    reflexion par jour 500, confirmation au-dessus de 100
echo  (valeurs en centimes). Restez devant l'ecran.
echo  Pour arreter l'agent : Ctrl+C.
echo ============================================================
echo.
node dist\index.js --run
echo.
echo L'agent est arrete. La fenetre du tableau de bord reste ouverte.
pause
