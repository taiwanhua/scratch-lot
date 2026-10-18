# 即時通道(RT)

即時通道 = `apps/realtime`(Cloudflare Worker + Durable Object `TenantHub`)。訂閱憑證、頻道、信號與協定的型別與簽章在 `@repo/domain/realtime`,api 與 Worker 共用同一份。

Worker 跑在 V8(不是 Node),只用 fetch、WebSocket、WebCrypto;`@repo/domain/realtime` 因為 api 與 Worker 共用,不得 import Node 模組(簽章只用 `crypto.subtle`)。

為什麼不用 Cloud Run 的 WebSocket:連線開著的 Cloud Run 實例持續計費,失去 `min-instances=0` 的零待機;最多 2 台實例時連線與送出信號可能在不同實例,得另加中繼;連線最長 60 分鐘會被切斷。Durable Object 搭配 Hibernation API(RT-01)閒置不計費,api 仍可休眠到 0。

## RT-01 Durable Object 必用 WebSocket Hibernation API

接下連線一律 `this.ctx.acceptWebSocket(server)`,訊息走類別上的 `webSocketMessage` 處理器;**不得用 `server.accept()` + `addEventListener`**。

對方關閉連線時的回應交給執行環境:`compatibility_date` ≥ 2026-04-07 預設開啟 `web_socket_auto_reply_to_close`,自動回 close frame,所以不必實作 `webSocketClose`;要在關閉時做事(清資料、記 log)才加。`apps/realtime/wrangler.jsonc` 的 `compatibility_date` 不得調回這個日期之前。

- 理由:`accept()` 讓 Durable Object 在整個連線期間常駐記憶體、持續計費;Hibernation API 在閒置時讓 Durable Object 休眠,連線不斷、閒置不計費(免費方案的前提)。
- 連線資訊(持有者、可訂閱頻道、已訂閱頻道、憑證到期時間)放 WebSocket 的 attachment(`serializeAttachment` / `deserializeAttachment`),不放類別欄位:休眠喚醒後類別欄位會重置,attachment 會保留。
- **attachment 一律經 `writeAttachment` 寫入**:寫不進去(Cloudflare 上限 16 KB)時記 log、以 `REALTIME_CLOSE_CODES.attachmentFailed`(4002)關閉該連線,不讓錯誤變成 500;前端照斷線處理。訂閱憑證的頻道數量不設上限,這是唯一的保護(憑證平常只有自己的個人頻道,看板頁才多一個 `board:<分店>`)。把關:`apps/realtime/src/index.test.ts`「連線資料寫入失敗」。
- **ping / pong 用 auto-response**:客戶端偵測半開連線的 ping 由 `TenantHub` constructor 登記的 `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(REALTIME_PING, REALTIME_PONG))` 回應,不喚醒 Durable Object、不進 `webSocketMessage`;**不得**在 `webSocketMessage` 裡處理 ping(每次都會喚醒、計時長)。字串正本在 `@repo/domain/realtime`,完全相同才會自動回應,客戶端送常數本身、不自己組 JSON。把關:`apps/realtime/src/index.test.ts`「偵測半開連線的 ping / pong」。只有代理程式送 ping(無人看管、連著時不輪詢);admin 不送:背景分頁的計時器會被節流或凍結而誤判斷線,每個分頁每天約 2,880 則訊息會吃掉 Durable Object 額度,而分頁回前景時 TanStack Query 照常重抓。理由全文見 `RealtimeConnection`(`apps/admin/src/lib/base/realtime/realtime-connection.ts`)的說明。
- 把關:`apps/realtime/src/hibernation.test.ts` 掃 `src/` 的正式程式碼,出現 `.accept()`,或 `TenantHub` 沒用 `ctx.acceptWebSocket` / `serializeAttachment` / `webSocketMessage` / `setWebSocketAutoResponse` 時測試失敗。

## RT-02 即時信號不帶資料

信號只有類型與編號(`{ type, id? }`),**不帶任何業務資料、不保存**;收到信號的一方用自己的身分向 API 拿資料。

- 理由:權限與可見範圍只由 API 判斷;Cloudflare 不留業務資料;連線當下沒訂閱的人錯過信號也沒關係(重連後補抓一次資料)。
- 把關:`isRealtimeSignal` 拒絕 `type` / `id` 以外的欄位,Worker 的 `/publish` 收到夾帶資料的信號回 400;Durable Object 不寫 storage。
- 要傳「哪一筆變了」用 `id`;要傳「變成什麼」就是該向 API 拿的資料,不放進信號。

## RT-04 訂閱憑證只放自己的頻道,看板頻道按需換發

憑證由 api 簽發(瀏覽器 `realtimeTicket`、代理程式 `POST /print-agent/realtime-ticket`),效期 10 分鐘,不存資料庫;Worker 只驗簽章與到期,不查資料庫。Durable Object 是**目前組織所屬的租戶**(根組織 = 平台)。

| 頻道               | 誰的憑證放                  | 信號                                               |
| ------------------ | --------------------------- | -------------------------------------------------- |
| `user:<id>`        | 瀏覽器,一律放               | `notification`、`badge:<模組 key>`、`print-result` |
| `print-agent:<id>` | 代理程式,只放這一個         | `print-job`                                        |
| `board:<店>`       | 看板頁按需換發,一張最多一個 | `board`(專案用)                                    |

- **看板頻道**:看板頁換發時帶 `board: { key, orgId }`,以下都成立才多放 `board:<店>`:① 持有該看板 key 在 `project/realtime-boards.ts` 登記的權限(只看那個看板);② 那家店在可見範圍內;③ 那家店與憑證同一個租戶。不成立就只放 `user:`,不報錯,`subscribe` 會被拒(`not-allowed`)。離開看板頁換回只含 `user:` 的憑證。前端用 `useRealtimeBoard(key, orgId)`。
- **換發**:在原連線上送 `renew`,不重新連線。時機是「收到憑證的時刻 + (效期 − 1 分鐘)」(不拿 `exp` 對使用者電腦的時鐘;最少間隔 30 秒),以及進出看板頁、換分店、切換目前組織。同一時間只跑一個換發,進行中又有變化就完成後補一次。新憑證取代可訂閱頻道,已訂閱但不在新憑證裡的自動取消。持有者(租戶 + 個人頻道)不同時回 `ticket-mismatch`,前端改連新租戶。代理程式另有「換發送出後 15 秒沒回應就重連」。
- **到期**:推送或收到訊息時發現憑證已過期就以 `REALTIME_CLOSE_CODES.ticketExpired`(4001)關閉、不推。權限被拔、帳號停用、看板店變成看不到,最晚 10 分鐘後就收不到信號;資料本身一律由 api 判斷(RT-02)。
- 理由:憑證平常只有一個頻道,不必設數量上限(唯一的保護見 RT-01 的 `writeAttachment`);總部不必把所有分店的看板頻道塞進憑證。
- 把關:`apps/api/src/realtime/realtime-ticket.service.test.ts`、`apps/realtime/src/index.test.ts`、`apps/admin/src/lib/base/realtime/realtime-connection.test.ts`。

## RT-05 高頻信號由送出端合併,接收端延後補抓

看板信號(`board`)以「租戶 + 頻道 + 類型」為單位,**2 秒內最多送一次**:第一次立即送,窗內的丟棄;`badge:*`、`notification` 等其他類型照送。前端收到任何信號後約 2.5 秒再重抓同一批資料(`REALTIME_FOLLOW_UP_MS`),補上窗內被丟掉的最後一次變動。

- 理由:伺服器不排計時器補送,因為 Cloud Run 在請求之外的 CPU 會被節流,計時器不可靠;改由接收端多抓一次,畫面最終一定是最新資料。合併紀錄只在本行程,多台實例各自合併。
- 正本:`apps/api/src/realtime/signal-coalescer.ts`(`COALESCED_SIGNAL_TYPES`)。
