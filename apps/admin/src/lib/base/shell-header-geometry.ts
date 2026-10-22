/**
 * 殼頂部的兩列高(theme.spacing 單位)。放在 lib 而不是殼的 `shell-geometry.ts`:頁面(pages)不能 import app(STRUCT-03),
 * 而頁面上從右側滑出的非遮罩抽屜(設計器的屬性抽屜)要從這兩列下面開始,不蓋住通知、頭像與頁籤列右端的「⋯」。
 */

/** 頂部列(`AppBar`)高(Figma AdminAppBar 64 高)。 */
export const APP_BAR_HEIGHT = 8;

/** 路由頁籤列(`RouteTabs`)高(Figma AdminRouteTabs 46 高)。 */
export const ROUTE_TABS_HEIGHT = 5.75;

/** 頂部列加頁籤列:內容區(`<main>`)從這裡開始。 */
export const SHELL_HEADER_HEIGHT = APP_BAR_HEIGHT + ROUTE_TABS_HEIGHT;
