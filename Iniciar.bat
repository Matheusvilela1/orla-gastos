@echo off
title Orla - Financas pessoais
cd /d "%~dp0"

rem Se ja estiver aberto, so abre o navegador
netstat -ano | findstr /r /c:":5181 .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:5181
  exit /b
)

if not exist node_modules (
  echo Instalando pela primeira vez, aguarde...
  call npm install --no-fund --no-audit
)

echo.
echo  Orla rodando em http://localhost:5181
echo  Seus dados ficam em: %~dp0dados\orla-financas.json
echo  Deixe esta janela aberta enquanto usa. Para sair, feche-a.
echo.
set ABRIR_NAVEGADOR=1
call npm run dev
