# scratch-lot 品牌值

本專案在[品牌註冊表](../branding.md)各列的實際值。規則、列的定義與「怎麼改」以註冊表為準;這裡只列與底座不同的值,列名沿用註冊表。新增或異動品牌文字、圖案、色彩、網域時,值寫在這裡,新增的列(新的儲存鍵、新的品牌位置)同時補進註冊表。

## 專案識別

scratch-lot 是引用專案,repo 是 [taiwanhua/scratch-lot](https://github.com/taiwanhua/scratch-lot),底座是 [taiwanhua/wowgo-base](https://github.com/taiwanhua/wowgo-base)。

## 程式碼

| 註冊表的列                                      | 本專案的值                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/project-config/src/project/public.ts` | `slug` = `scratch-lot`、`brand.name` =「scratch-lot」、`brand.primary` = `#FFD700`、`admin.documentTitle` =「scratch-lot 後台管理」、`admin.webApp` = 名稱 / 短名稱「ScratchLot」、`themeColor` / `backgroundColor` = `#1B2440`、`front.metadata` =「scratch-lot — ScratchLot 刮刮樂智慧管理系統」/「scratch-lot — ScratchLot Smart Scratch-off Lottery Management System」等 |
| `apps/admin/public/project/`(app 圖示)          | **暫用圖示**(10/27 定,之後可換):深藍 `#1B2440` 底、銀色刮層 `#C9CED8`(刮痕點 `#9AA2B1`)上刮出金色 `#FFD700`(主色)的「S」—— ScratchLot 字首;正本 `icon.svg` / `icon-maskable.svg`(圖案約佔 57%)/ `icon-apple.svg`(圖案放大),`favicon.ico` 同一張圖                                                                                                                             |
| 瀏覽器儲存鍵(全部由 slug 生成)                  | `scratch-lot-admin-locale`、`scratch-lot-admin-color-mode`、`scratch-lot-admin-color-scheme-light` / `-dark`、`scratch-lot-admin-session`(BroadcastChannel)、`scratch-lot-admin-route-tabs:<userId>`、`scratch-lot-admin-sidenav`、`scratch-lot-admin-sections:<userId>`                                                                                                      |
| 本機 MongoDB 的資料庫名                         | `scratch-lot`(`apps/api/.env.example` 的 `MONGODB_URI`、根 `.env.example` 的 `LOCAL_MONGO_DB`)                                                                                                                                                                                                                                                                                |
| `packages/project-config/src/project/mail.ts`   | `senderEmail` = `no-reply@scratch-lot.com`(寄件網域 scratch-lot.com 在 Resend 驗證)、`signature` =「scratch-lot 後台管理系統」;寄件人 `scratch-lot <no-reply@scratch-lot.com>`、主旨前綴「【scratch-lot】」、內文「scratch-lot 後台帳號」                                                                                                                                     |
| 即時通道網域                                    | `rt-dev.scratch-lot.com`(dev)、`rt-staging.scratch-lot.com`(staging)、`rt.scratch-lot.com`(production);Worker 名稱在 `deploy/project/cloud.json` 的 `realtime.worker`,三環境的 `REALTIME_URL` 都已寫入 `deploy/env/<環境>.yaml`                                                                                                                                               |
| Storybook 網域                                  | `storybook.scratch-lot.com`(正式,`main`)、`storybook-staging.scratch-lot.com`(`staging` 分支)、`storybook-dev.scratch-lot.com`(`dev` 分支):Vercel 專案 `scratch-lot-storybook` 的網域。正式網域公開;分支網域是 Preview,受 Vercel 部署保護                                                                                                                                     |
| `orgs`(根組織)`name`                            | 「scratch-lot」(`apps/db-migrator/seeds/project/settings.ts` 的 `rootOrg.name`)                                                                                                                                                                                                                                                                                               |

## 標籤色票 `tagPalettes`

分類標籤用的 10 組顏色(規格 18.5):欄位管理的選項顏色、遊戲顏色、人力需求範本顏色、行事曆特殊日顏色都從這組選,只能選、不能輸入色碼。與狀態色 `statusPalettes`(info / success / warning / error)分開,只表分類(FIGMA-13)。每組文字對底色都達 WCAG AA(≥ 4.5:1,單元測試 `apps/admin/src/lib/project/tag-palettes.test.ts` 逐組算)。

| 代號     | 名稱 | 淺色 底 / 字          | 深色 底 / 字          |
| -------- | ---- | --------------------- | --------------------- |
| `blue`   | 藍   | `#E3F2FD` / `#0D47A1` | `#0B2A4A` / `#90CAF9` |
| `cyan`   | 青   | `#E0F7FA` / `#006064` | `#04363B` / `#80DEEA` |
| `green`  | 綠   | `#E8F5E9` / `#1B5E20` | `#11331A` / `#A5D6A7` |
| `lime`   | 萊姆 | `#F1F8E9` / `#33691E` | `#26330F` / `#C5E1A5` |
| `yellow` | 黃   | `#FFF8E1` / `#7A5B00` | `#3A2F05` / `#FFE082` |
| `orange` | 橘   | `#FFF3E0` / `#9A3B00` | `#3D2306` / `#FFCC80` |
| `red`    | 紅   | `#FFEBEE` / `#B71C1C` | `#3E1214` / `#EF9A9A` |
| `pink`   | 粉   | `#FCE4EC` / `#880E4F` | `#3D1028` / `#F48FB1` |
| `purple` | 紫   | `#F3E5F5` / `#4A148C` | `#2A1238` / `#CE93D8` |
| `grey`   | 灰   | `#F5F5F5` / `#424242` | `#2E2E2E` / `#E0E0E0` |

- 程式:色值 `apps/admin/src/lib/project/tag-palettes.ts`;代號清單(前後端共用,api 以它驗證)`packages/domain/src/project/tag-palette/keys.ts`;畫面一律經 `components/project/TagPaletteChip`、`TagPaletteSelect` 取用
- Figma:Screens 的本機變數集合 `Draft/tagPalettes`(20 個變數,Light / Dark),值同上表
- 升格後搬到 `packages/ui/src/theme/tokens.ts` 的 `tagPalettes`、登記改寫進底座[品牌註冊表](../branding.md),Figma 改綁 Library 同名集合

## 設計資源

| 檔案                                                                             | fileKey                  | 目前用途                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [scratch-lot Brand Library](https://www.figma.com/design/vR4pASiPSzHnxC1y778zAx) | `vR4pASiPSzHnxC1y778zAx` | 品牌 Library(`Brand` → `Color`,Light);由本機外掛 `wowgo-base Brand Sync` 依 `projectPublic.brand` 套用並發布;維護者 taiwanhua;Wowgo 團隊 Design system 專案 |
| [scratch-lot Screens](https://www.figma.com/design/sXOJkIX53eBMUyDE8yYUJm)       | `sXOJkIX53eBMUyDE8yYUJm` | 後台與業務畫面;取自 Screens Starter,共用元件為 wowgo-base Library 遠端實例、品牌引用 scratch-lot Brand Library;維護者 taiwanhua                             |

畫面與元件的節點見[專案節點表](figma-nodes.md)。
