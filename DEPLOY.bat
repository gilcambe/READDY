@echo off
echo ╔══════════════════════════════════════════╗
echo ║  NEXIA OS — Deploy Script v3.0           ║
echo ║  Execute na pasta nexia_final do projeto ║
echo ╚══════════════════════════════════════════╝
echo.

REM Verificar se está na pasta certa
if not exist "netlify" (
    echo ERRO: Execute este script dentro da pasta nexia_final
    pause
    exit
)

echo [1/5] Copiando arquivos do patch...

REM Copiar arquivos (ajuste o caminho do ZIP extraido)
set PATCH=%~dp0nexia_patch

xcopy /y "%PATCH%\netlify\functions\cortex-chat.js" "netlify\functions\"
xcopy /y "%PATCH%\netlify\functions\autodev-engine.js" "netlify\functions\"
xcopy /y "%PATCH%\nexia\nexia-store.html" "nexia\"
xcopy /y "%PATCH%\nexia\nexia-autodemo.html" "nexia\"
xcopy /y "%PATCH%\nexia\social-media-auto.html" "nexia\"
xcopy /y "%PATCH%\nexia\nexia-striker.html" "nexia\"
xcopy /y "%PATCH%\nexia\studio.html" "nexia\"
xcopy /y "%PATCH%\core\nexia-theme.css" "core\"
xcopy /y "%PATCH%\_redirects" ".\"
xcopy /y "%PATCH%\ces\ces-app-executivo.html" "ces\"

REM Criar pastas de temas
if not exist "tenants\nexia" mkdir "tenants\nexia"
if not exist "tenants\bezsan" mkdir "tenants\bezsan"
if not exist "tenants\viajante-pro" mkdir "tenants\viajante-pro"
if not exist "tenants\splash" mkdir "tenants\splash"
if not exist "tenants\ces" mkdir "tenants\ces"

xcopy /y /s "%PATCH%\tenants\" "tenants\"

echo [2/5] Fazendo git add...
git add -A

echo [3/5] Fazendo commit...
git commit -m "fix: design system + store refactor + cortex autodev + novos modulos v3"

echo [4/5] Fazendo push...
git push origin main

echo [5/5] Deploy concluído!
echo.
echo Acesse: https://nexiaos.netlify.app
echo.
pause
