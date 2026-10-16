"use client";

/**
 * 模組圖示的白名單登錄表(#287)。
 *
 * 為什麼要白名單:`@mui/icons-material` 有上萬個圖示,整包 import 會讓 admin 的 bundle
 * 多出好幾 MB;而模組圖示是**資料**(seed 給初始值、模組與權限頁可換),值來自資料庫,
 * 不能由 bundler 靜態分析出「哪些圖示會被用到」。折衷是這份登錄表:
 *
 * - 每個圖示走**單檔路徑** `@mui/icons-material/XxxOutlined`(不是 `{ Xxx } from "@mui/icons-material"`),
 *   Vite / bunchee 只打包表裡列到的這 30 個;
 * - 資料庫存的是表裡的 key(kebab-case),不是元件名 —— 換圖示庫時只改這份表;
 * - 值不在表裡(舊資料、手改、空值)一律回 `DEFAULT_MODULE_ICON`,畫面不會缺一塊。
 *
 * 風格一律 **Outlined**(與 Figma「Icons」頁的 `Draft/ModuleIcon` 變體一一對應,變體名 `key=<name>`);
 * 顏色由 MUI `SvgIcon` 的 `fill: currentColor` 決定,跟著父層文字色走(STYLE-04)。
 * 新增圖示 = 這份表加一列 + Figma 加一個變體,兩邊同名。
 */
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import AppsOutlined from "@mui/icons-material/AppsOutlined";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import BusinessOutlined from "@mui/icons-material/BusinessOutlined";
import CalendarMonthOutlined from "@mui/icons-material/CalendarMonthOutlined";
import CategoryOutlined from "@mui/icons-material/CategoryOutlined";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import ExtensionOutlined from "@mui/icons-material/ExtensionOutlined";
import FilterAltOutlined from "@mui/icons-material/FilterAltOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import HomeOutlined from "@mui/icons-material/HomeOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import LabelOutlined from "@mui/icons-material/LabelOutlined";
import ListAltOutlined from "@mui/icons-material/ListAltOutlined";
import LockOutlined from "@mui/icons-material/LockOutlined";
import MailOutlined from "@mui/icons-material/MailOutlined";
import NotificationsOutlined from "@mui/icons-material/NotificationsOutlined";
import PeopleOutlined from "@mui/icons-material/PeopleOutlined";
import PersonOutlined from "@mui/icons-material/PersonOutlined";
import PrintOutlined from "@mui/icons-material/PrintOutlined";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import RestaurantMenuOutlined from "@mui/icons-material/RestaurantMenuOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import StarBorderOutlined from "@mui/icons-material/StarBorderOutlined";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import ViewModuleOutlined from "@mui/icons-material/ViewModuleOutlined";
import type { ComponentType } from "react";

import { DotIcon } from "./DotIcon";
import type { IconProps } from "./icon-props";

/** 登錄表的一列:給人看的短詞 + 畫出來的元件。 */
export interface ModuleIconEntry {
  /**
   * 選單上的短詞(繁中)。ui 不做 i18n(I18N-01),這裡當**預設顯示名**;
   * 要跟著語系換的呼叫端用 `ModuleIconPicker` 的 `labelOf` 覆寫。
   */
  label: string;
  Icon: ComponentType<IconProps>;
}

/**
 * key → 圖示。**key 一經使用就不再改名**(資料庫存的是它),要換圖形就換同一列的 `Icon`。
 * 排列順序 = 選單顯示順序(用途相近的排在一起)。
 */
export const MODULE_ICONS = {
  dashboard: { label: "儀表板", Icon: DashboardOutlined },
  home: { label: "首頁", Icon: HomeOutlined },
  business: { label: "組織", Icon: BusinessOutlined },
  "account-tree": { label: "組織樹", Icon: AccountTreeOutlined },
  people: { label: "使用者", Icon: PeopleOutlined },
  person: { label: "個人", Icon: PersonOutlined },
  shield: { label: "權限", Icon: ShieldOutlined },
  key: { label: "金鑰", Icon: KeyOutlined },
  lock: { label: "鎖定", Icon: LockOutlined },
  apps: { label: "應用", Icon: AppsOutlined },
  extension: { label: "模組", Icon: ExtensionOutlined },
  tune: { label: "調整", Icon: TuneOutlined },
  settings: { label: "設定", Icon: SettingsOutlined },
  filter: { label: "篩選", Icon: FilterAltOutlined },
  label: { label: "標籤", Icon: LabelOutlined },
  category: { label: "分類", Icon: CategoryOutlined },
  grid: { label: "格狀", Icon: ViewModuleOutlined },
  list: { label: "清單", Icon: ListAltOutlined },
  folder: { label: "資料夾", Icon: FolderOutlined },
  description: { label: "文件", Icon: DescriptionOutlined },
  inventory: { label: "庫存", Icon: Inventory2Outlined },
  store: { label: "商店", Icon: StorefrontOutlined },
  receipt: { label: "單據", Icon: ReceiptLongOutlined },
  chart: { label: "圖表", Icon: BarChartOutlined },
  calendar: { label: "行事曆", Icon: CalendarMonthOutlined },
  mail: { label: "信件", Icon: MailOutlined },
  notifications: { label: "通知", Icon: NotificationsOutlined },
  restaurant: { label: "菜單", Icon: RestaurantMenuOutlined },
  star: { label: "收藏", Icon: StarBorderOutlined },
  print: { label: "列印", Icon: PrintOutlined },
} as const satisfies Record<string, ModuleIconEntry>;

/** 白名單裡的 key。 */
export type ModuleIconKey = keyof typeof MODULE_ICONS;

/** 顯示順序(= `MODULE_ICONS` 的宣告順序);選單與 story 都照它列。 */
export const MODULE_ICON_KEYS = Object.keys(MODULE_ICONS) as ModuleIconKey[];

/** 沒設定、或值不在白名單時畫的圖示(與 SideNav 未設定圖示的選單列一致)。 */
export const DEFAULT_MODULE_ICON: ComponentType<IconProps> = DotIcon;

/**
 * 值是不是白名單裡的 key(把資料庫來的字串收斂成 `ModuleIconKey`,不用 `as`)。
 * 用 `Object.hasOwn` 而不是 `in`:`in` 連原型上的名字都算命中,
 * `"toString"` 會被當成合法 key,然後 `MODULE_ICONS[key].Icon` 在執行期炸。
 */
export const isModuleIconKey = (
  value: string | null | undefined,
): value is ModuleIconKey =>
  value !== null && value !== undefined && Object.hasOwn(MODULE_ICONS, value);

/** 取 key 對應的圖示元件;不在白名單(含 `null` / 空字串)回 `DEFAULT_MODULE_ICON`。 */
export const moduleIconOf = (
  key: string | null | undefined,
): ComponentType<IconProps> =>
  isModuleIconKey(key) ? MODULE_ICONS[key].Icon : DEFAULT_MODULE_ICON;

/** 取 key 的預設短詞;不在白名單回 `undefined`(由呼叫端決定顯示什麼)。 */
export const moduleIconLabelOf = (
  key: string | null | undefined,
): string | undefined =>
  isModuleIconKey(key) ? MODULE_ICONS[key].label : undefined;
