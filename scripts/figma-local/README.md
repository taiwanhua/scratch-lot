# Figma 本機品牌同步外掛

這支外掛在 Figma 檔案內直接執行，沒有本機服務、token、MCP 程式碼傳輸或新的 receipt。品牌值只來自 `packages/project-config/src/project/public.ts`；`export-brand.mjs` 沿用 `scripts/figma-sync/brand.mjs` 的色盤與陰影算法。正式操作與升級紀錄見 [toolbox](../../docs/agents/toolbox.md#figma-品牌同步)。

## 安裝與品牌庫

1. 在專案 repo 執行 `pnpm exec turbo run build --filter=@repo/ui --filter=@repo/project-config`。
2. 在 Figma 使用獨立的 `<專案> Brand Library` 檔案，取得網址 `/design/` 後的 file key。不要在底座 Library 或 Screens 執行品牌庫寫入。
3. 執行 `node scripts/figma-local/export-brand.mjs --file-key <品牌庫key> --out .artifacts/figma-local/brand.json`。產物是可丟棄的 2 KB 左右 JSON，不提交版控。
4. 在 Figma → Plugins → Development → Import plugin from manifest… 選 `scripts/figma-local/manifest.json`。外掛不連網；第一次匯入後從 Development 選 `wowgo-base Brand Sync`。
5. 選剛產生的 JSON，先「預覽品牌變更」，確認目前 file key 與預期相同，再「套用品牌」。完成後再預覽一次，待處理應為 0；最後在 Figma 發布品牌庫。

外掛建立或更新 `Brand` 和 `Color` 兩個 Light 集合，每個集合六個 `primary/*` 變數；`Color` alias 指向同檔的 `Brand`，並更新 `Shadow/Primary`。同名集合有多模式、同名變數型別不符或同名樣式不唯一時會停止；不刪除其他變數、模式或樣式。

## 專案 Screens

Screens 必須是**另一個檔案**，共用畫面引用底座已發布的遠端元件實例。直接複製底座 Design System 檔會得到本地元件，不能當作可升級的 Screens。第一次建立時，從已有遠端 Base 實例的 Screens 範本複製；若尚無範本，先從啟用的底座 Library 插入元件實例組成畫面，再保存為專案 Screens。專案專有畫面、文案和覆寫保存在這個檔案。

1. 在 Screens 的 Figma Library 面板啟用底座與本專案 Brand Library，先接受可用的 Library 更新。Plugin API 無法代替這個 UI 步驟。
2. 開外掛，貼 Screens 網址中的 file key，選底座與專案 Library。先選一張代表畫面或目前頁面，按「檢查綁定」；確認例外為 0、遠端元件實例數與待處理數合理，再「補綁專案色」。完成後再檢查，待處理應為 0。
3. 其餘需要套色的頁面同樣處理；初建可選「全部頁面」。外掛只處理**直接綁定**底座 `Brand`/`Color` 六個 primary 角色的 fill/stroke，保留私人變數、文字、圖、布局和元件實例關係。`Shadow/Primary` 在 Screens 用 Figma 原生 **Swap libraries** 換成專案品牌樣式。
4. 初建時另外覆寫品牌示例文字、商標與業務內容。核對一個 Primary Button、巢狀側欄和一張代表畫面：專案色與陰影、文字、變體、布局及遠端 Base 主元件連結。這是有變更時的代表性驗收；新/變更的角色或共用元件另選對應樣本，不必每次重掃全部畫面。

底座發布新 Library 時，專案先依 `base-sync upgrade` 準備程式碼 PR，再在 Figma 接受對應 Library 更新、按受影響範圍重新檢查及補綁，將版本連結、file key 和代表畫面結果記在升級 PR。Library 版本與 Git tag 在發布說明互相指向；Git 合併不會自動讓 Figma 接受更新。

專案想把通用元件回收到底座時，先核對元件沒有專案品牌或業務依賴。程式碼走 `base-sync inspect` / `contribute`；Figma 元件以原生 Move published components（適用時）移至底座 Library，發布後再隨正式 tag 供專案採用。不要把整份專案 Screens 合回底座。

## 中斷與範圍

預覽會記住當時的檔案 key、Library 選擇、scope 和待改綁定；套用前狀態有變就停止並要求重預覽。若執行中斷，先在當前檔重預覽，工具只列尚需變更的位置，不從上一次的動作序號猜測完成度。不要在不明檔案或未核對 Library 的狀態重試。

本外掛不負責複製檔案、發布或接受 Library，也不驗證 Figma 畫面的視覺排版；後三者用 Figma 原生功能與代表畫面檢查。既有 `deploy/project/figma/receipts/` 是舊流程的歷史結果，不作為這支外掛的輸入或新成功條件。離線驗證：`node --test scripts/figma-local/*.test.mjs`。
