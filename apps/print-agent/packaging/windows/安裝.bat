@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem 列印代理程式的 Windows 安裝 / 更新(apps/print-agent/README.md「安裝」)。
rem 右鍵「以系統管理員身分執行」。更新時再執行一次:偵測到既有設定就保留金鑰,不必重新配對。

net session >nul 2>&1
if errorlevel 1 (
  echo 請在「安裝.bat」上按右鍵,選「以系統管理員身分執行」。
  pause
  exit /b 1
)

set "SOURCE=%~dp0"
set "TARGET=%ProgramFiles%\print-agent"
set "CONFIG=%ProgramData%\print-agent"
set "SERVICE=%TARGET%\print-agent-service.exe"

rem 已安裝過:先停服務才能覆蓋執行檔(stopwait 等到真的停了;stop 只送出停止就返回)
sc query print-agent >nul 2>&1
if not errorlevel 1 (
  "%SERVICE%" stopwait >nul 2>&1
)

if not exist "%TARGET%" mkdir "%TARGET%"
copy /y "%SOURCE%print-agent.exe" "%TARGET%\" >nul || goto :fail
copy /y "%SOURCE%print-agent-service.exe" "%TARGET%\" >nul || goto :fail
copy /y "%SOURCE%print-agent-service.xml" "%TARGET%\" >nul || goto :fail
copy /y "%SOURCE%VERSION" "%TARGET%\" >nul || goto :fail

rem 設定檔目錄內含代理程式金鑰:只留 SYSTEM(服務身分)與系統管理員
if not exist "%CONFIG%" mkdir "%CONFIG%"
icacls "%CONFIG%" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" >nul || goto :fail

if exist "%CONFIG%\config.json" (
  echo 偵測到既有設定:保留代理程式金鑰,不必重新配對。
  echo 後台按了 [重新配對] 要換新配對碼時,請改執行「重新配對.bat」。
) else (
  call :pair || goto :fail
)

sc query print-agent >nul 2>&1
if errorlevel 1 (
  "%SERVICE%" install || goto :fail
)
"%SERVICE%" start || goto :fail

echo.
echo 安裝完成:代理程式已在背景執行(開機自動啟動)。
echo 請回到印表機管理頁的「代理程式」分頁,確認狀態為「已連線」。
pause
exit /b 0

:pair
echo.
echo 請從印表機管理頁 [新增代理程式] 的畫面複製伺服器網址與配對碼。
set "SERVER="
set "CODE="
set /p "SERVER=伺服器網址:"
set /p "CODE=配對碼:"
"%TARGET%\print-agent.exe" pair --server "%SERVER%" --code "%CODE%"
rem 區塊內的半形括號要寫成 ^( ^),否則 cmd 會把 ) 當成區塊結束而整支中斷
if errorlevel 1 (
  echo 配對失敗,請確認後再輸入一次^(按 Ctrl+C 結束^)。
  goto :pair
)
exit /b 0

:fail
echo.
echo 安裝失敗,請把上面的訊息拍照給系統管理員。
pause
exit /b 1
