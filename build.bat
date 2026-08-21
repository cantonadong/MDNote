@echo off
setlocal

cd /d "%~dp0"
set "TARGET=%~dp0build\bin\MDNote.exe"

set "GOCACHE=%TEMP%\MDNote-go-build"
set "GOTELEMETRY=off"
if not exist "%GOCACHE%" mkdir "%GOCACHE%"

where go.exe >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Go\bin\go.exe" set "PATH=%ProgramFiles%\Go\bin;%PATH%"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  goto :failed
)

set "WAILS="
for /f "delims=" %%I in ('where wails.exe 2^>nul') do if not defined WAILS set "WAILS=%%~fI"
if not defined WAILS if exist "%USERPROFILE%\go\bin\wails.exe" set "WAILS=%USERPROFILE%\go\bin\wails.exe"
if not defined WAILS if exist "%HOMEDRIVE%%HOMEPATH%\go\bin\wails.exe" set "WAILS=%HOMEDRIVE%%HOMEPATH%\go\bin\wails.exe"
if not defined WAILS (
  for /f "usebackq delims=" %%I in (`go env GOPATH 2^>nul`) do if exist "%%I\bin\wails.exe" set "WAILS=%%I\bin\wails.exe"
)
rem A batch file launched elevated can have a different USERPROFILE from the
rem signed-in desktop user. Check user Go installations as a final fallback.
if not defined WAILS (
  for /d %%I in ("%SystemDrive%\Users\*") do if exist "%%~fI\go\bin\wails.exe" set "WAILS=%%~fI\go\bin\wails.exe"
)
if not defined WAILS (
  echo [ERROR] wails.exe was not found in PATH or %%USERPROFILE%%\go\bin.
  echo Install it with: go install github.com/wailsapp/wails/v2/cmd/wails@latest
  goto :failed
)
echo Using Wails: %WAILS%

echo [1/2] Closing running MDNote instances...
taskkill /F /IM MDNote.exe >nul 2>nul
taskkill /F /IM mdnote.exe >nul 2>nul

echo [2/2] Building build\bin\MDNote.exe...
rem Do not add -clean: build\bin may contain the user's mdnote.ini settings.
rem Wails only regenerates the Windows icon when icon.ico is absent. Remove
rem this generated cache so the current build\appicon.png is always embedded.
if not exist "%~dp0build\appicon.png" (
  echo [ERROR] App icon was not found: build\appicon.png
  goto :failed
)
if exist "%~dp0build\windows\icon.ico" del /F /Q "%~dp0build\windows\icon.ico"
if exist "%~dp0build\windows\icon.ico" (
  echo [ERROR] Could not remove the cached Windows icon: build\windows\icon.ico
  goto :failed
)
"%WAILS%" build -ldflags "-s -w" -o MDNote.exe
if errorlevel 1 (
  echo [ERROR] Build failed.
  goto :failed
)

if not exist "%~dp0build\windows\icon.ico" (
  echo [ERROR] Wails did not generate build\windows\icon.ico from build\appicon.png.
  goto :failed
)
powershell.exe -NoProfile -Command "$source=Get-Item -LiteralPath '%~dp0build\appicon.png'; $generated=Get-Item -LiteralPath '%~dp0build\windows\icon.ico'; if($generated.LastWriteTimeUtc -lt $source.LastWriteTimeUtc){ Write-Host '[ERROR] Generated icon.ico is older than appicon.png.'; exit 1 }"
if errorlevel 1 goto :failed

if not exist "%TARGET%" (
  echo [ERROR] Wails reported success, but the output file does not exist:
  echo         %TARGET%
  goto :failed
)

echo.
echo Build complete: %TARGET%
powershell.exe -NoProfile -Command "$f=Get-Item -LiteralPath $env:TARGET; Write-Host ('Modified: ' + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')); Write-Host ('Size:     ' + $f.Length + ' bytes'); Write-Host ('SHA256:   ' + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash)"
exit /b 0

:failed
echo.
echo Build did not update: %TARGET%
echo Press any key to close this window...
pause >nul
exit /b 1
