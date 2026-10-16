# 即時通道(RT)

即時通道 = `apps/realtime`(Cloudflare Worker + Durable Object `TenantHub`)。訂閱憑證、頻道、信號與協定的型別與簽章在 `@repo/domain/realtime`,api 與 Worker 共用同一份。

## RT-01 Durable Object 必用 WebSocket Hibernation API

接下連線一律 `this.ctx.acceptWebSocket(server)`,訊息走類別上的 `webSocketMessage` 處理器;**不得用 `server.accept()` + `addEventListener`**。

對方關閉連線時的回應交給執行環境:`compatibility_date` ≥ 2026-04-07 預設開啟 `web_socket_auto_reply_to_close`,自動回 close frame,所以不必實作 `webSocketClose`;要在關閉時做事(清資料、記 log)才加。`apps/realtime/wrangler.jsonc` 的 `compatibility_date` 不得調回這個日期之前。

- 理由:`accept()` 讓 Durable Object 在整個連線期間常駐記憶體、持續計費;Hibernation API 在閒置時讓 Durable Object 休眠,連線不斷、閒置不計費(免費方案的前提)。
- 連線資訊(持有者、可訂閱頻道、已訂閱頻道、憑證到期時間)放 WebSocket 的 attachment(`serializeAttachment` / `deserializeAttachment`),不放類別欄位:休眠喚醒後類別欄位會重置,attachment 會保留。
- **attachment 一律經 `writeAttachment` 寫入**:寫不進去(Cloudflare 上限 16 KB)時記 log、以 `REALTIME_CLOSE_CODES.attachmentFailed`(4002)關閉該連線,不讓錯誤變成 500;前端照斷線處理。訂閱憑證的頻道數量不設上限,這是唯一的保護(憑證平常只有自己的個人頻道,看板頁才多一個 `board:<分店>`)。把關:`apps/realtime/src/index.test.ts`「連線資料寫入失敗」。
- 把關:`apps/realtime/src/hibernation.test.ts` 掃 `src/` 的正式程式碼,出現 `.accept()`,或 `TenantHub` 沒用 `ctx.acceptWebSocket` / `serializeAttachment` / `webSocketMessage` 時測試失敗。

## RT-02 即時信號不帶資料

信號只有類型與編號(`{ type, id? }`),**不帶任何業務資料、不保存**;收到信號的一方用自己的身分向 API 拿資料。

- 理由:權限與可見範圍只由 API 判斷;Cloudflare 不留業務資料;連線當下沒訂閱的人錯過信號也沒關係(重連後補抓一次資料)。
- 把關:`isRealtimeSignal` 拒絕 `type` / `id` 以外的欄位,Worker 的 `/publish` 收到夾帶資料的信號回 400;Durable Object 不寫 storage。
- 要傳「哪一筆變了」用 `id`;要傳「變成什麼」就是該向 API 拿的資料,不放進信號。
