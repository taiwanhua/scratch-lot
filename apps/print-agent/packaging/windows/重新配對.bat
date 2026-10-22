@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem 列印代理程式的 Windows 重新配對(apps/print-agent/README.md「重新配對」)。
rem 後台按了 [重新配對] 之後,在已安裝的電腦上右鍵「以系統管理員身分執行」:換成新配對碼的金鑰,再重新啟動服務。
rem 「安裝.bat」偵測到既有設定會保留舊金鑰,所以重新配對要用這支。

net session >nul 2>&1
if errorlevel 1 (
  echo 請在「重新配對.bat」上按右鍵,選「以系統管理員身分執行」。
  pause
  exit /b 1
)

set "TARGET=%ProgramFiles%\print-agent"
set "CONFIG=%ProgramData%\print-agent"
set "SERVICE=%TARGET%\print-agent-service.exe"

rem 沒裝過(執行檔、設定檔或服務任一不在):先執行安裝
set "INSTALLED=1"
if not exist "%TARGET%\print-agent.exe" set "INSTALLED="
if not exist "%SERVICE%" set "INSTALLED="
if not exist "%CONFIG%\config.json" set "INSTALLED="
sc query print-agent >nul 2>&1
if errorlevel 1 set "INSTALLED="
if not defined INSTALLED (
  echo 這台電腦還沒有安裝代理程式:請先在「安裝.bat」上按右鍵,選「以系統管理員身分執行」。
  pause
  exit /b 1
)

call :pair || goto :fail

rem 服務還拿著舊金鑰:停掉再啟動,改用新的設定
"%SERVICE%" stop >nul 2>&1
"%SERVICE%" start || goto :fail

echo.
echo 重新配對完成:代理程式已用新的配對重新啟動。
echo 請回到印表機管理頁的「代理程式」分頁,確認狀態為「已連線」。
pause
exit /b 0

:pair
echo.
echo 請從印表機管理頁 [重新配對] 的畫面複製伺服器網址與配對碼。
set "SERVER="
set "CODE="
set /p "SERVER=伺服器網址:"
set /p "CODE=配對碼:"
"%TARGET%\print-agent.exe" pair --server "%SERVER%" --code "%CODE%" --force
rem 區塊內的半形括號要寫成 ^( ^),否則 cmd 會把 ) 當成區塊結束而整支中斷
if errorlevel 1 (
  echo 配對失敗,請確認後再輸入一次^(按 Ctrl+C 結束^)。
  goto :pair
)
exit /b 0

:fail
echo.
echo 重新配對失敗,請把上面的訊息拍照給系統管理員。
pause
exit /b 1
