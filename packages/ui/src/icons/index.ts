"use client";

/**
 * 殼用的線性圖示,path 取自 Figma Admin Shell 匯出的 SVG(chevron 16×16、icon-slot 16×16),
 * 顏色一律 `currentColor`(由父層文字色決定,STYLE-04 深色模式自動正確)。
 * 本檔是 `@repo/ui/icons` 的出口;每個圖示一檔(REACT-07)。
 *
 * 另有 `module-icon-registry`:模組圖示的 MUI Outlined 白名單—— 那些圖示是**資料選出來的**
 * (值存在資料庫),所以不手畫,改以單檔路徑 import 的登錄表限制打包範圍。
 *
 * **通用操作圖示**(view / edit / delete / chevron-double-left / right)介於兩者之間:
 * 它們是**靜態的**(哪裡用得到由程式決定,不是資料),但設計稿(Figma `Draft/ActionIcon` 253:3264)
 * 標明取自 `@mui/icons-material` Outlined,所以不手畫 path,一樣走**單檔路徑** import
 * 各成一檔(STYLE-05),不進 `MODULE_ICONS` 登錄表 —— 那張表的 key 是落庫的資料值。
 */
export * from "./icon-props";
export * from "./ChevronDownIcon";
export * from "./ChevronLeftIcon";
export * from "./ChevronRightIcon";
export * from "./ChevronDoubleLeftIcon";
export * from "./ChevronDoubleRightIcon";
export * from "./DotIcon";
export * from "./CloseIcon";
export * from "./CheckIcon";
export * from "./HelpIcon";
export * from "./ViewIcon";
export * from "./EditIcon";
export * from "./DeleteIcon";
export * from "./SettingsIcon";
export * from "./AddIcon";
export * from "./ArrowUpIcon";
export * from "./ArrowDownIcon";
export * from "./SystemModeIcon";
export * from "./LightModeIcon";
export * from "./DarkModeIcon";
export * from "./LogoutIcon";
export * from "./DevicesIcon";
export * from "./NotificationsIcon";
export * from "./CheckCircleIcon";
export * from "./ErrorCircleIcon";
export * from "./MenuIcon";
export * from "./MoreHorizIcon";
export * from "./module-icon-registry";
