@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\uvicorn.exe (
  echo Once: python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
  exit /b 1
)
echo Studium OCR -> http://127.0.0.1:8787
.venv\Scripts\uvicorn.exe app:app --reload --host 127.0.0.1 --port 8787
