@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set PORT=8787

set "PHP="
where php >nul 2>nul && set "PHP=php"
if not defined PHP if exist "C:\xampp\php\php.exe" set "PHP=C:\xampp\php\php.exe"
if not defined PHP if exist "A:\xampp\php\php.exe" set "PHP=A:\xampp\php\php.exe"
if not defined PHP if exist "A:\xampp\php82\php.exe" set "PHP=A:\xampp\php82\php.exe"
if not defined PHP if exist "%ProgramFiles%\php\php.exe" set "PHP=%ProgramFiles%\php\php.exe"

if defined PHP (
  echo Starting doc2ai on http://127.0.0.1:%PORT%/  ^(close this window to stop^)
  start "" "http://127.0.0.1:%PORT%/"
  "!PHP!" -S 127.0.0.1:%PORT% -t .
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Starting doc2ai on http://127.0.0.1:%PORT%/  ^(close this window to stop^)
  start "" "http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)

echo No local web server found - opening index.html directly.
echo The app works from the file system too; "Add folder" may be limited in some browsers.
start "" "index.html"
