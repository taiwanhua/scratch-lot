/**
 * 頂部列(殼的 `AppBar`)高(theme.spacing 單位;Figma AdminAppBar 64 高)。
 * 放在 lib 而不是殼的 `shell-geometry.ts`:頁面(pages)不能 import app(STRUCT-03),
 * 而頁面上從右側滑出的非遮罩抽屜(設計器的屬性抽屜)要從頂部列下面開始,不蓋住通知與頭像。
 */
export const APP_BAR_HEIGHT = 8;
