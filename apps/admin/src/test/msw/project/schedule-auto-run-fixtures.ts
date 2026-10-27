/** 套用範本與自動排班的夾具(元件測試與 mock 模式共用)。 */

/** 套用範本 / 自動排班的週範本(平日標準週、旺季週)。 */
export const ROSTER_WEEK_TEMPLATES = [
  {
    id: "wk-normal",
    name: "平日標準週",
    days: [
      ["tpl-early", "tpl-restock"],
      ["tpl-early", "tpl-late"],
      ["tpl-early", "tpl-late"],
      ["tpl-early", "tpl-late", "tpl-restock"],
      ["tpl-early", "tpl-late"],
      ["tpl-early", "tpl-late", "tpl-restock"],
      ["tpl-early", "tpl-restock"],
    ],
  },
  {
    id: "wk-peak",
    name: "旺季週",
    days: Array.from({ length: 7 }, () => [
      "tpl-early",
      "tpl-late",
      "tpl-restock",
    ]),
  },
];

/** 這家店自動排班條件的生效設定。 */
export const AUTO_RUN_CONDITIONS = [
  { key: "continuePreviousEntry", enabled: true },
  { key: "leaderCountFirst", enabled: true },
  { key: "monthlyShiftBalance", enabled: false },
  { key: "allowOverlappingDemands", enabled: false },
];
