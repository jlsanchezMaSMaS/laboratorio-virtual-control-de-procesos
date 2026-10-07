@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>&1
if not errorlevel 1 (
  start "Servidor laboratorio virtual" cmd /k "node server.js"
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    start "Servidor laboratorio virtual" cmd /k ""%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js"
  ) else (
    where py.exe >nul 2>&1
    if not errorlevel 1 (
      start "Servidor laboratorio virtual" cmd /k "py -m http.server 8000"
    ) else (
      where python.exe >nul 2>&1
      if not errorlevel 1 (
        start "Servidor laboratorio virtual" cmd /k "python -m http.server 8000"
      ) else (
        echo No se encontro Node.js ni Python. Instale uno de ellos para ejecutar la aplicacion.
        pause
        exit /b 1
      )
    )
  )
)

timeout /t 2 /nobreak >nul
start "" http://localhost:8000
