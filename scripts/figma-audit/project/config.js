// scratch-lot 的 Figma 稽核設定(專案維護;底座升級不覆蓋,base-sync 判為 project)。
// 用法見 ../README.md:在 Figma MCP use_figma 裡,把本檔全文貼在稽核腳本前面一起執行。
// 欄位意思見 README「設定檔欄位」;節點 id 是 scratch-lot Screens(sXOJkIX53eBMUyDE8yYUJm)的頁 id。
const AUDIT_CONFIG = {
  // 專案名詞:底座共用腳本(scripts/figma-audit/*.js)不得出現這些字(figma-audit.test.mjs 檢查)
  projectTerms: [
    "刮刮樂",
    "班表",
    "lottery",
    "scratch-lot",
    "ScratchLot",
    "TicketCell",
    "TicketGrid",
    "CashPoint",
    "StoreTopBar",
    "BoardBook",
    "收銀",
    "看板",
    "張數",
    "排班",
    "人力需求",
  ],

  // 底座草稿頁:名稱以這個開頭的頁只綁底座變數,不檢查「殘留底座主色」
  baseDraftPagePrefix: "Base Draft",
  // 底座草稿元件 description 的固定前綴「【底座・本輪草稿,…】」
  draftMarker: "本輪草稿",
  // 本機過渡變數集合的名稱前綴(例 Draft/tagPalettes;回收後要沒有綁定)
  draftCollectionPrefix: "Draft/",
  // wowgo-base Design System 的變數集合 key(Color / Radius / Primitives / Brand)
  baseCollections: [
    "9d2d67ea73654a9894d5c083e28754341526fba4",
    "84c5f309f7b50688d1eca745ea4db116afb1ad5a",
    "1eea29cadf44f500544c6b840aea015c8a3b092b",
    "aa51fafef4bb2e4d3b578ccaa8bc8f1a930ed17e",
  ],
  // 上面之中放 primary/* 的集合(Color、Brand):專案頁不得殘留這兩個集合的 primary/* 綁定
  basePrimaryCollections: [
    "9d2d67ea73654a9894d5c083e28754341526fba4",
    "aa51fafef4bb2e4d3b578ccaa8bc8f1a930ed17e",
  ],

  // audit-layout.js
  layout: {
    // 欄位元件(主元件或元件集合名稱):同列欄位上緣與高度要一致
    field:
      /TextField|SelectField|^Draft\/Select$|Autocomplete|OrgTreeSelect|DatePicker/,
    // 時間軸容器內上下堆疊的列距(rowGapInContainer);不需要時設 null
    rowGap: {
      container: /ScheduleTimelineDemand|^demand /,
      rows: /ScheduleTimelineBlock|^bar |^vacancy|^disabled/,
      gap: 4,
      minWidthRatio: 0.6,
    },
  },

  // audit-sync.js
  sync: {
    // 一次跑完的專案頁(店面管理、叫貨與進貨、庫存管理、班表管理、帳戶管理、輸出報表、經銷商管理、檔案管理)
    pages: [
      "65:14",
      "91:14",
      "69:14",
      "70:14",
      "93:14",
      "94:14",
      "95:14",
      "97:14",
    ],
    // 只檢查遮罩(overlayNoPage / overlayNotCovering)的頁:沒有尺寸 Section 的底座草稿頁
    overlayOnlyPages: [{ id: "41:5914", label: "Base Draft" }],
    // 回報時的頁名:去掉「Screen / 」前綴
    pageLabel: (name) => name.slice(9),
    // 尺寸 Section 名稱 → 代號與畫面寬度;code 為 D 的是電腦(不查篩選抽屜、不比 app bar)
    sizes: {
      "電腦 1440": { code: "D", width: 1440 },
      "平板 1024": { code: "T", width: 1024 },
      "手機 390": { code: "M", width: 390 },
    },
    // 框名後綴 → 應放的尺寸 Section
    sizeSuffix: { " · 平板": "平板 1024", " · 手機": "手機 390" },
    // 畫面編號(框名開頭)
    screenCode: /^([A-Z]{2}-\d\d)/,
    // 不算按鈕的實例(主元件名稱)
    nonButton:
      /Tag|Badge|Select|TextField|Radio|Checkbox|Alert|Ticket|Legend|Stepper|Avatar|Icon|OrgTree|Switch|Tab$|Draft\/Tab|SideNav|NavRail|AppBar|BookCard|TableCell/,
    // 標題列:這些實例、這些名稱的框(不在實例內)
    headInstance: /CashPointHeader|StoreTopBar/,
    headFrame: /^(store-top|toolbar|title|doc-head)$/,
    // 平板 / 手機最上面的 app bar(Kind=Dialog 是全螢幕對話框,不算標題列)
    appBar: { name: /ScratchLotAppBar/, skipKind: "Dialog" },
    // 手機收進選單的按鈕:[選單按鈕, 收起來的按鈕]
    merged: [
      ["+ 新增 ▾", ["+ 人力需求", "+ 新增排班"]],
      ["⋯", ["套用範本", "自動排班"]],
    ],
    // 版面本來就不同的「畫面編號|按鈕|尺寸」,值是理由(回報時照列)
    exempt: (() => {
      const sc46 =
        "電腦 / 平板是整頁加日期浮層;手機是 SC-45 背景加底部月曆,工具列在背景裡不計(結構不同)";
      const out = {
        "ST-40|篩選(1)|D":
          "電腦把篩選條件攤在列表上方(篩選列);平板 / 手機照 RW-01 收成 [篩選] 按鈕 + 抽屜",
        "ST-36|開班|M":
          "手機的卡片展開是底部面板,蓋住下面其他收銀點的標題列(電腦 / 平板原地展開,看得到)",
      };
      for (const b of [
        "+ 人力需求",
        "+ 新增排班",
        "套用範本",
        "自動排班",
        "發布",
        "月",
        "週",
        "日",
        "班表",
        "限制 1 · 提醒 12",
        "+ 新增 ▾",
        "⋯",
      ])
        out[`SC-46|${b}|M`] = sc46;
      return out;
    })(),
    // 共用區塊要用元件實例(sharedHandDrawn):依序比對框名,第一條符合的規則生效
    //   why:框本身就是手畫的;children:框的每個非實例子節點都算;contains:[元件名稱, 理由],框裡找不到該實例才算
    //   pages:只在這些頁檢查
    sharedBlocks: [
      { frame: /^cash-point(:|$)/, why: "要用 CashPointHeader" },
      {
        frame: /^(store-top|toolbar)$/,
        pages: ["65:14"],
        why: "要用 StoreTopBar",
      },
      { frame: /^nav-rail/, why: "要用 ScratchLotNavRail" },
      { frame: /^app-bar$/, why: "要用 ScratchLotAppBar" },
      { frame: /^side-?nav/i, why: "要用 ScratchLotSideNav" },
      { frame: /^cards$/, children: "看板卡片要用 BoardBookCard" },
      {
        frame: /^grid\+legend$/,
        contains: [
          [/TicketCell/, "格子要用 TicketCell"],
          [/TicketGridLegend/, "圖例要用 TicketGridLegend"],
        ],
      },
      {
        frame: /^ticket-grid$/,
        contains: [[/TicketCell/, "格子要用 TicketCell"]],
      },
      {
        frame: /^(Stepper|stepper|steps)$/,
        contains: [[/StepperStep/, "要用 StepperStep"]],
      },
    ],
    // 篩選:按鈕文字、抽屜畫面名稱、註解裡寫明照共用規則的字
    filterButton: /^篩選/,
    filterDrawer: /篩選/,
    filterNote: /RW-01/,
  },

  // audit-legend.js
  legend: {
    // 標示用顏色(變數名稱):畫面上用到就要有圖例樣本
    mark: [
      "warning/lighter",
      "warning/main",
      "error/lighter",
      "error/main",
      "success/lighter",
      "info/lighter",
      "cyan/bg", // 特殊日底色(tagPalettes,行事曆設定的顏色;示範 cyan)
      "primary/lighter",
      "grey/100",
    ],
    // 標示用元件(主元件或元件集合名稱):實例內部的顏色也算標示
    markers:
      /^Draft\/(ScheduleTimelineBlock|ScheduleTimelineDemand|ScheduleTimelineMore|StatusChip|RosterCell|LeadTag|HatchBg|ScheduleAutoMark|UnmatchedPunchMark)$/,
    // 圖例項目元件與它的文字屬性
    legendItem: "Draft/LegendItem",
    legendLabelProp: "Label#289:0",
  },

  // audit.js
  audit: {
    // 畫面框內不能出現的開發用文字(devTextInScreens)
    devText: [
      /\b(ST|IN|PU|AC|RE|DE|MD|SC|RC|RW|BS)-\d{2}[a-c]?\b/, // 設計稿編號
      /第 ?\d+(\.\d+)* ?(節|章)|規格/, // 規格章節
      /RANGE_TOO_LARGE|show-cost|\b(store|inventory|purchasing|accounts|reports|dealers|games|schedule|system|master-data)\.[a-z][a-z-]+|swapComponent|Draft\/|PageTabs|SLOT/, // 錯誤碼、權限 key、實作詞
    ],
    // 底座參考畫面(baseScreensNotFromRef):底座草稿頁上寬度符合、名稱符合的框
    baseRefScreen: /^BS-/,
    baseRefWidth: 1440,
    baseRefNote: "對應現有畫面",
    baseAppBar: /AdminAppBar/,
  },

  // audit-crossview.js:跨畫面資料比對規則(名稱 → 規則)。scratch-lot 的班表比對仍用 docs/tmp/figma-base-round/audit-roster.js。
  crossView: {},
};
