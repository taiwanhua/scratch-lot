# 列印代理程式(`@repo/print-agent`)

裝在店內電腦上的背景服務:向 API 接收列印工作,轉成 ESC/POS 點陣指令,經 TCP 9100 送到收據機(58mm,XP-Q90EC 網路版)。雲端連不進店內網路,所以由它主動接收。api 端與資料見 [docs/modules/printers.md](../../docs/modules/printers.md)。

```
API 建立 print_job → 送出 print-agent:<id> 的 print-job 信號
→ 代理程式認領(等待中 → 已送出,成功才印)→ 拿 PNG → ESC/POS → TCP 9100 → 收據機 → 切紙
→ 回報 已印 / 失敗(缺紙、連不上印表機、其他)
```

## 模組

| 模組                     | 做什麼                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pairing`            | 伺服器網址 + 配對碼 → 換長期金鑰 → 寫入本機設定檔;已有設定檔時不覆蓋(加 `--force` 才重新配對)                                                                                                                                                                                                                                          |
| `src/api-client`         | 用金鑰呼叫 API:拿工作、認領、拿圖片、回報、換訂閱憑證、心跳。路徑與形狀的正本是 `@repo/domain/printing`                                                                                                                                                                                                                                |
| `src/realtime`           | Node 內建 WebSocket 連即時通道,收 `print-agent:<id>`;在原連線換發憑證(送出後 15 秒沒回應就重連);**每 30 秒送 ping、10 秒沒收到 pong 就重連**(偵測半開連線:連線其實斷了、兩端都沒發現);斷線依 1 / 2 / 5 / 10 / 30 秒退避重連                                                                                                            |
| `src/agent`              | 接起來:啟動先拿一次未完成工作;沒連上即時通道時每 60 秒輪詢、重新連上先補抓;**不論有沒有連上都每 60 秒心跳**(維持「已連線」)                                                                                                                                                                                                            |
| `src/job-runner`         | 佇列:同一台印表機一次一張、依序印;認領已超過 2 分鐘結果逾時的不印;回報在佇列外退避重試(約 90 秒);心跳查狀態時佇列忙就用上次的狀態                                                                                                                                                                                                      |
| `src/escpos`             | PNG 解碼(純 JS 的 `pngjs`;不用含原生模組的圖片套件,單一執行檔才不必帶原生二進位)→ 單色點陣 → `GS v 0` 分段(每段 128 列)→ `GS V 66` 切紙;`DLE EOT 4` 查缺紙(不回應的機型每台記一次 warn、照常列印);一張單據從連線到關閉共用 30 秒總期限,收據機卡住時 destroy 並回報 `other`;先讀 IHDR 擋掉超過 `PRINT_IMAGE_MAX_HEIGHT_DOTS` 的圖再解碼 |
| `src/simulator`          | 模擬印表機:不送出,把收到的 ESC/POS 指令解回圖片存成 PNG                                                                                                                                                                                                                                                                                |
| `src/logging`            | 每天一個 log 檔(`print-agent-YYYY-MM-DD.log`)、保留 14 天;不寫金鑰                                                                                                                                                                                                                                                                     |
| `src/release`、`scripts` | 打包與發布(見下文)                                                                                                                                                                                                                                                                                                                     |

**只印一次**:信號與輪詢可能同時帶來同一張工作。本機先擋掉最近處理過的工作 id,真正的保證是 API 的認領(條件更新,第二次 409)。

## 開發

```bash
pnpm --filter @repo/print-agent test          # 單元 + 整合(假 9100 伺服器)
pnpm --filter @repo/print-agent run lint
pnpm --filter @repo/print-agent run check-types
pnpm --filter @repo/print-agent build         # dist/print-agent.cjs(node dist/print-agent.cjs version)
```

本機接 api(`http://localhost:5001`)試印,不必有收據機:

```bash
# 1. 後台 → 印表機管理 → [新增代理程式],拿到配對碼
pnpm --filter @repo/print-agent agent pair --server http://localhost:5001 --code <配對碼> --config-dir ./tmp/config
# 2. 跑起來;--simulator 把每張單據存成 PNG(看得到會印出什麼)
pnpm --filter @repo/print-agent agent run --config-dir ./tmp/config --simulator ./tmp/printed
```

- `--config-dir` / `--log-dir` 只給開發與測試用;正式安裝用固定位置(下表)。`tmp/` 已列在 `.gitignore`。
- 伺服器網址只收 `https://`;本機 `localhost` / `127.0.0.1` 才允許 `http://`。
- 版本:發布時烘進執行檔;直接跑原始碼時是 `0.0.0`(已有發布版本時,印表機管理頁會把它標「請更新」,開發時忽略即可)。

## 安裝位置與服務身分

| 平台    | 設定檔(含金鑰)                                         | log                                | 執行檔                          | 服務                                                    |
| ------- | ------------------------------------------------------ | ---------------------------------- | ------------------------------- | ------------------------------------------------------- |
| Windows | `C:\ProgramData\print-agent\config.json`               | `C:\ProgramData\print-agent\logs\` | `C:\Program Files\print-agent\` | WinSW 2.12.0,LocalSystem,自動啟動、當掉重啟             |
| Linux   | `/etc/print-agent/config.json`                         | `/var/log/print-agent/`            | `/opt/print-agent/`             | systemd `print-agent.service`,系統使用者 `print-agent`  |
| macOS   | `/Library/Application Support/print-agent/config.json` | `/Library/Logs/print-agent/`       | `/usr/local/print-agent/`       | launchd `/Library/LaunchDaemons/print-agent.plist`,root |

設定檔只有服務身分能讀:Windows 以 `icacls` 只留 SYSTEM 與 Administrators;Linux 目錄 0700 / 檔案 0600,擁有者 `print-agent`;macOS 目錄 0700 / 檔案 0600,擁有者 root。

log 的保留期以代理程式自己的檔案為準(每天一個、14 天):服務管理員那邊不再存 stdout(Linux `StandardOutput=null`、macOS stdout 指到 `/dev/null`、WinSW 只留兩個 1MB 的滾動檔),當掉時的 stderr 才另外留(Linux 的 journald、macOS 的 `stderr.log`)。

## 安裝(店家)

1. 印表機管理 → 代理程式分頁 → 依電腦系統下載安裝檔;[新增代理程式] 選分店與名稱,留著顯示伺服器網址與配對碼(10 分鐘有效)的畫面。
2. 解壓縮,執行安裝:
   - **Windows**:在 `安裝.bat` 上按右鍵 →「以系統管理員身分執行」。
   - **Linux**:`sudo ./install.sh`(Debian / Ubuntu / Raspberry Pi OS;需要 systemd 與 `useradd`)。
   - **macOS(Apple 晶片)**:在「終端機」進到解壓後的資料夾,執行 `sudo ./install.sh`。
3. 依提示貼上伺服器網址與配對碼 → 安裝程式註冊服務並啟動 → 回到代理程式分頁確認「已連線」。

**Windows 跳出 SmartScreen**(「Windows 已保護您的電腦」):執行檔沒有程式碼簽章,第一次執行 `安裝.bat` 或 `print-agent.exe` 時可能出現。確認檔案是從印表機管理頁下載的,按「其他資訊」→「仍要執行」。若檔案被標成「已封鎖」,先在 zip 檔上按右鍵 →「內容」→ 勾「解除封鎖」→ 確定,再解壓縮。

**macOS 第一次被擋**:執行檔沒有 Apple 開發者簽章。`install.sh` 會先解除下載帶來的隔離標記;如果仍出現「無法打開,因為無法驗證開發者」,到「系統設定 → 隱私權與安全性」最下方按「仍要打開」,或在終端機執行 `xattr -dr com.apple.quarantine <解壓後的資料夾>` 再執行一次安裝。

**更新**:下載新版,再執行一次安裝。偵測到既有設定檔時保留金鑰,不必重新配對。

**重新配對**(後台按了 [重新配對],舊金鑰已失效):服務 log 會出現「代理程式金鑰無效或已撤銷」。以系統管理員身分執行 `print-agent pair --server <網址> --code <新配對碼> --force`(Windows 在 `C:\Program Files\print-agent\`;Linux / macOS 用 `sudo`,Linux 完成後 `sudo chown print-agent:print-agent /etc/print-agent/config.json`),再重新啟動服務。

**移除**:

- Windows:`"C:\Program Files\print-agent\print-agent-service.exe" uninstall`,再刪除 `C:\Program Files\print-agent\` 與 `C:\ProgramData\print-agent\`。
- Linux:`sudo systemctl disable --now print-agent`,刪除 `/etc/systemd/system/print-agent.service`、`/opt/print-agent`、`/etc/print-agent`、`/var/log/print-agent`。
- macOS:`sudo launchctl bootout system/print-agent`,刪除 `/Library/LaunchDaemons/print-agent.plist`、`/usr/local/print-agent`、`/Library/Application Support/print-agent`、`/Library/Logs/print-agent`。

## 實機測試(收據機到貨後)

實機測試時,代理程式還要確認:

- **固定 IP**:到貨後撰寫設定步驟(路由器保留 IP 綁收據機 MAC;路由器不能設時才用收據機網頁或芯燁設定工具設固定 IP,注意不可與其他設備撞號)。
- **9100 是否回 `DLE EOT 4`**:不回應時代理程式照常列印,但查不到缺紙(log 會出現一次「收據機沒有回應 DLE EOT 4」);要確認機型設定能否打開即時狀態回傳。
- **切紙**:`GS V 66 0` 是否每張都切;**分段**:每段 128 列是否會斷印。

## 打包(四個平台)

用 Node 內建的單一執行檔(SEA,Node 24 的 `--experimental-sea-config` + `postject`)。SEA 以執行打包腳本的 Node 執行檔為底,所以**只能打包本機平台**;四個平台由發布 workflow 在四種 runner 各打一次。

```bash
pnpm --filter @repo/print-agent package --version 1.0.0                         # Linux / macOS
pnpm --filter @repo/print-agent package --version 1.0.0 --winsw <WinSW-x64.exe>  # Windows
```

輸出 `dist/release/print-agent-<平台>.zip|tar.gz`,內含執行檔、安裝程式、服務設定與 `VERSION`。腳本最後會執行一次 `print-agent version` 核對版本。

| 平台        | 壓縮檔                           | runner             | 服務                           |
| ----------- | -------------------------------- | ------------------ | ------------------------------ |
| Windows x64 | `print-agent-windows-x64.zip`    | `windows-latest`   | WinSW(`print-agent-service.*`) |
| Linux x64   | `print-agent-linux-x64.tar.gz`   | `ubuntu-latest`    | systemd                        |
| Linux arm64 | `print-agent-linux-arm64.tar.gz` | `ubuntu-24.04-arm` | systemd                        |
| macOS arm64 | `print-agent-macos-arm64.tar.gz` | `macos-15`         | launchd                        |

- macOS:注入後以 ad-hoc 簽章(`codesign --sign -`,Apple 晶片不簽不能執行);不是 Apple 開發者簽章或公證(開發者帳號每年 99 美元,先不申請;需要時再加)。
- Windows:注入會讓 node.exe 原本的 Authenticode 簽章失效(打包時的 `signature seems corrupted` 警告是預期的),不影響執行。
- 不支援 Intel Mac 與 Windows arm64;需要時加一個建置目標。

## 發布

`.github/workflows/print-agent-release.yml`(只能手動觸發):四平台建置 → 重算 SHA-256 → 上傳到該環境私有 bucket 的 `print-agent/<版本>/` → 更新 `print-agent/manifest.json` → 只保留最近 3 版。步驟、權限與第一次發布前要準備的資源見 [docs/deployment.md「列印代理程式發布」](../../docs/deployment.md#列印代理程式發布print-agent-releaseyml);指令速查見 [toolbox](../../docs/agents/toolbox.md#手動觸發的-workflow部署e2e資料庫還原)。
