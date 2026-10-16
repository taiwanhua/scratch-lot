#!/bin/sh
# 列印代理程式的 Linux 安裝 / 更新(systemd;apps/print-agent/README.md「安裝」)。
#   sudo ./install.sh
# 更新時再執行一次:偵測到既有設定就保留金鑰,不必重新配對。
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "請用 sudo ./install.sh 執行"
  exit 1
fi

HERE=$(cd "$(dirname "$0")" && pwd)
TARGET=/opt/print-agent
CONFIG_DIR=/etc/print-agent
LOG_DIR=/var/log/print-agent
USER_NAME=print-agent

# 服務身分:專用的系統使用者(設定檔內含金鑰,只有它能讀)
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$USER_NAME"
fi

systemctl stop print-agent 2>/dev/null || true

install -d -m 0755 "$TARGET"
install -m 0755 "$HERE/print-agent" "$TARGET/print-agent"
install -m 0644 "$HERE/VERSION" "$TARGET/VERSION"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$CONFIG_DIR"
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$LOG_DIR"

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
chown "$USER_NAME:$USER_NAME" "$CONFIG_DIR/config.json"
chmod 0600 "$CONFIG_DIR/config.json"

install -m 0644 "$HERE/print-agent.service" /etc/systemd/system/print-agent.service
systemctl daemon-reload
systemctl enable print-agent >/dev/null
systemctl restart print-agent

echo "安裝完成:代理程式已在背景執行(開機自動啟動)。"
echo "請回到印表機管理頁的「代理程式」分頁,確認狀態為「已連線」。"
