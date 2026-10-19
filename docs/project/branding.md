# scratch-lot 品牌值

本專案在[品牌註冊表](../branding.md)各列的實際值。規則、列的定義與「怎麼改」以註冊表為準;這裡只列與底座不同的值,列名沿用註冊表。新增或異動品牌文字、圖案、色彩、網域時,值寫在這裡,新增的列(新的儲存鍵、新的品牌位置)同時補進註冊表。

## 專案識別

scratch-lot 是引用專案,repo 是 [taiwanhua/scratch-lot](https://github.com/taiwanhua/scratch-lot),底座是 [taiwanhua/wowgo-base](https://github.com/taiwanhua/wowgo-base)。

## 程式碼

| 註冊表的列                                      | 本專案的值                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/project-config/src/project/public.ts` | `slug` = `scratch-lot`、`brand.name` =「scratch-lot」、`brand.primary` = `#FFD700`、`admin.documentTitle` =「scratch-lot 後台管理」、`front.metadata` =「scratch-lot — ScratchLot 刮刮樂智慧管理系統」/「scratch-lot — ScratchLot Smart Scratch-off Lottery Management System」等 |
| 瀏覽器儲存鍵(全部由 slug 生成)                  | `scratch-lot-admin-locale`、`scratch-lot-admin-color-mode`、`scratch-lot-admin-color-scheme-light` / `-dark`、`scratch-lot-admin-session`(BroadcastChannel)、`scratch-lot-admin-route-tabs:<userId>`、`scratch-lot-admin-sidenav`、`scratch-lot-admin-sections:<userId>`          |
| 本機 MongoDB 的資料庫名                         | `scratch-lot`(`apps/api/.env.example` 的 `MONGODB_URI`、根 `.env.example` 的 `LOCAL_MONGO_DB`)                                                                                                                                                                                    |
| `packages/project-config/src/project/mail.ts`   | `senderEmail` = `no-reply@scratch-lot.com`(寄件網域 scratch-lot.com 在 Resend 驗證)、`signature` =「scratch-lot 後台管理系統」;寄件人 `scratch-lot <no-reply@scratch-lot.com>`、主旨前綴「【scratch-lot】」、內文「scratch-lot 後台帳號」                                         |
| 即時通道網域                                    | `rt-dev.scratch-lot.com`(dev)、`rt-staging.scratch-lot.com`(staging)、`rt.scratch-lot.com`(production);Worker 名稱在 `deploy/project/cloud.json` 的 `realtime.worker`,三環境的 `REALTIME_URL` 都已寫入 `deploy/env/<環境>.yaml`                                                   |
| Storybook 網域                                  | `storybook.scratch-lot.com`(正式,`main`)、`storybook-staging.scratch-lot.com`(`staging` 分支)、`storybook-dev.scratch-lot.com`(`dev` 分支):Vercel 專案 `scratch-lot-storybook` 的網域。正式網域公開;分支網域是 Preview,受 Vercel 部署保護                                         |
| `orgs`(根組織)`name`                            | 「scratch-lot」(`apps/db-migrator/seeds/project/settings.ts` 的 `rootOrg.name`)                                                                                                                                                                                                   |

## 設計資源

| 檔案                                                                             | fileKey                  | 目前用途                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [scratch-lot Brand Library](https://www.figma.com/design/vR4pASiPSzHnxC1y778zAx) | `vR4pASiPSzHnxC1y778zAx` | 品牌 Library(`Brand` → `Color`,Light);由本機外掛 `wowgo-base Brand Sync` 依 `projectPublic.brand` 套用並發布;維護者 taiwanhua;Wowgo 團隊 Design system 專案 |
| [scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm)       | `sXOJkIX53eBMUyDE8yYUJm` | 後台與業務畫面;取自 Screens Starter,共用元件為 wowgo-base Library 遠端實例、品牌引用 scratch-lot Brand Library;維護者 taiwanhua                             |

畫面與元件的節點見[專案節點表](figma-nodes.md)。
