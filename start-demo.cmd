@echo off
setlocal
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0tools\run_demo.py" %*
  exit /b
)
if exist "%~dp0.cache\runtime\python\python.exe" (
  "%~dp0.cache\runtime\python\python.exe" "%~dp0tools\run_demo.py" %*
  exit /b
)
python "%~dp0tools\run_demo.py" %*
