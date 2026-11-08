/**
 * `@repo/domain/project/lottery-settings` 的出口檔(bunchee 由 `exports` 名反推本檔)。
 * 刮刮樂設定(`lottery-settings`)的規則(張數店規格第 4 節、5.5、9.1、9.2;正本
 * `docs/modules/project/lottery-settings.md`):
 *
 * - `keys.ts`:模組 key、權限 key
 * - `settings.ts`:設定的定義(key、選項、程式預設)與沿組織樹的生效值
 * - `count-mode-change.ts`:改盤點制度時各分店怎麼變、哪些擋下
 *
 * 盤點制度本身(`COUNT_MODES`、`countModeOf`、`renumberDueOf`…)在 `@repo/domain/project/lottery` 的 `count-mode.ts`。
 */
export * from "./count-mode-change";
export * from "./keys";
export * from "./settings";
