#!/bin/sh
# 列印代理程式的 macOS 安裝 / 更新(launchd;apps/print-agent/README.md「安裝」)。
#   sudo ./install.sh
# 執行檔沒有 Apple 開發者簽章:先解除下載帶來的隔離標記,否則會被 Gatekeeper 擋下。
# 更新時再執行一次:偵測到既有設定就保留金鑰,不必重新配對。
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "請用 sudo ./install.sh 執行"
  exit 1
fi

HERE=$(cd "$(dirname "$0")" && pwd)
TARGET=/usr/local/print-agent
CONFIG_DIR="/Library/Application Support/print-agent"
LOG_DIR=/Library/Logs/print-agent
PLIST=/Library/LaunchDaemons/print-agent.plist

xattr -dr com.apple.quarantine "$HERE" 2>/dev/null || true

launchctl bootout system/print-agent 2>/dev/null || true

install -d -m 0755 "$TARGET"
install -m 0755 "$HERE/print-agent" "$TARGET/print-agent"
install -m 0644 "$HERE/VERSION" "$TARGET/VERSION"
xattr -d com.apple.quarantine "$TARGET/print-agent" 2>/dev/null || true
install -d -m 0700 -o root -g wheel "$CONFIG_DIR"
install -d -m 0755 -o root -g wheel "$LOG_DIR"

if [ -f "$CONFIG_DIR/config.json" ]; then
  echo "偵測到既有設定:保留代理程式金鑰,不必重新配對。"
else
  echo "請從印表機管理頁 [新增代理程式] 的畫面複製伺服器網址與配對碼。"
  while :; do
    printf "伺服器網址:"
    read -r SERVER
    printf "配對碼:"
    read -r CODE
    if "$TARGET/print-agent" pair --server "$SERVER" --code "$CODE"; then
      break
    fi
    echo "配對失敗,請確認後再輸入一次(按 Ctrl+C 結束)。"
  done
fi
chmod 0600 "$CONFIG_DIR/config.json"

install -m 0644 -o root -g wheel "$HERE/print-agent.plist" "$PLIST"
launchctl bootstrap system "$PLIST"
launchctl enable system/print-agent
launchctl kickstart -k system/print-agent

echo "安裝完成:代理程式已在背景執行(開機自動啟動)。"
echo "請回到印表機管理頁的「代理程式」分頁,確認狀態為「已連線」。"
