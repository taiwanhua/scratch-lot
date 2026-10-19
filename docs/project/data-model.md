# 資料模型地圖(專案)

本專案自己的 collection。格式與跨檔約定照底座 [docs/data-model.md](../data-model.md);欄位、型別、索引的正本在程式碼 `apps/api/src/project/database/`(schema 與 repository,登記在 `registrations.ts`)。本檔只寫現況:表建立時才列。

## 專案資料

刮刮樂的表名前綴 `lottery_`、排班與出勤的前綴 `schedule_`(唯一例外是欄位選項顏色的專案臨時表 `project_field_option_colors`,屬於底座欄位管理的 S2 客製)。表由建立它的功能各自登記,用途、欄位與規則詳見各模組文件 `docs/modules/project/<模組 key>.md`;排班的表不得引用刮刮樂的表(依賴方向:刮刮樂 → 排班)。

| collection | 種子 / 業務 | 用途 | 模組文件 | schema 檔 |
| ---------- | ----------- | ---- | -------- | --------- |
