// 「Screen / 店面管理」的交班結帳、日結、存銀行與 58mm 單據(store.js 的後半)。
// 前置:project/_header.js + project/_screen-helpers.js;在 store.js 之後執行(沿用同一頁)。
// 依專案規格 6.9、6.10、6.11、8.7、12。
PROJ_PAGE = await figma.getNodeByIdAsync("64:14");
const page = figma.root.children.find((p) => p.name === "Screen / 店面管理");
await figma.setCurrentPageAsync(page);
const out = {};
async function kvRows(c, rows) {
  for (const [k, v, col, strong] of rows)
    add(c, await kv(k, v, strong, col), "FILL");
}

// ---- 交班結帳(6.9)----
const STEPS = ["盤點", "兌獎", "抽屜", "確認"];
const x0 = 1560 + 900;
{
  const { s, content } = await pshell(
    "店面管理 / 交班結帳 ③ 抽屜",
    "店面管理",
    "店面管理",
    "交班結帳・店內櫃台",
  );
  await titleRow(content, "交班結帳 · 店內櫃台", "王小明 · 08:02 開班");
  add(content, await steps(STEPS, 2));
  const cols = add(
    content,
    al("HORIZONTAL", { name: "cols", itemSpacing: 16 }),
    "FILL",
  );
  const L = add(cols, await card("應有現金", 8));
  L.resize(520, L.height);
  L.layoutSizingVertical = "HUG";
  add(L, await txt("應有現金", "Subtitle/1"));
  await kvRows(L, [
    ["期初零用金", "3,000"],
    ["銷售(142 張)", "+ 14,550"],
    ["兌獎(3 筆)", "− 1,200"],
    ["投庫(2 筆)", "− 4,000"],
    ["出庫", "0"],
    ["調貨支出(現金)", "0"],
    ["調貨收入(現金)", "0"],
    ["退貨退款", "0"],
    ["現金更正", "0"],
  ]);
  await divider(L);
  add(L, await kv("應有現金", "12,350", true), "FILL");
  await wrapCaption(L, "只算已完成的單據;每一列可以點開看明細與單據。");
  const R = add(cols, await card("實點", 10), "FILL");
  add(R, await txt("實點(依面額清點)", "Subtitle/1"));
  const dc = await pinst("Draft/DenominationCount");
  add(R, dc, "FILL");
  const r100 = dc.findAll((n) => n.name === "row")[2];
  await setProps(
    r100.findOne((n) => n.type === "INSTANCE"),
    { Value: "18" },
  );
  await setText(r100, "2,100", "1,800");
  await setText(dc, "12,350", "12,050");
  await divider(R);
  add(R, await kv("差額 = 實點 − 應有", "− 300", true, "error/main"), "FILL");
  add(R, await select("差額原因(必填)", "找錯錢", 320));
  add(
    R,
    await inst(
      "Draft/Alert",
      { Severity: "Warning" },
      {
        Message:
          "審核中:現金更正 #C-012 +500、撤銷售出 #R-008 −500 → 已自動帶入差額原因說明。",
        Action: false,
      },
    ),
    "FILL",
  );
  add(
    content,
    await actionsRow([await btn("上一步", "Outlined"), await btn("下一步")]),
    "FILL",
  );
  page.appendChild(s);
  s.x = x0;
  fitHeight(s);
  out.checkout3 = s.id;
}
{
  const { s, content } = await pshell(
    "店面管理 / 交班結帳 ④ 確認",
    "店面管理",
    "店面管理",
    "交班結帳・店內櫃台",
  );
  await titleRow(content, "交班結帳 · 店內櫃台", "王小明 · 08:02 開班");
  add(content, await steps(STEPS, 3));
  const c = add(content, await card("確認", 10));
  c.resize(720, c.height);
  c.layoutSizingVertical = "HUG";
  await kvRows(c, [
    ["盤點", "沿用 10:32 的盤點(30 分鐘內)"],
    ["兌獎", "3 筆,1,200"],
    ["應有現金", "12,350"],
    ["實點", "12,050"],
    ["差額", "− 300(找錯錢)", "error/main"],
  ]);
  await divider(c);
  const r = add(
    c,
    al("HORIZONTAL", { name: "handover", itemSpacing: 16 }),
    "FILL",
  );
  add(r, await field("留給下一班", "3,000", { width: 200 }));
  add(r, await select("接班人", "李小華", 240));
  await wrapCaption(
    c,
    "送出後這一班結束,下一班可以先開班。接班人當面點過零用金後核准,就等於確認。",
  );
  await wrapCaption(c, "送出時自動列印結帳單(交班人、接班人簽名)。");
  add(
    content,
    await actionsRow([
      await btn("上一步", "Outlined"),
      await btn("送出結帳確認申請"),
    ]),
    "FILL",
  );
  page.appendChild(s);
  s.x = x0 + 1560;
  out.checkout4 = s.id;
}
{
  const f = al("HORIZONTAL", {
    name: "店面管理 / 交班結帳 ① 盤點 · ② 兌獎",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 24,
    paddingBottom: 24,
    itemSpacing: 16,
  });
  f.fills = [await paint("bg/default")];
  const a = add(f, await card("① 盤點", 12));
  a.resize(460, a.height);
  a.layoutSizingVertical = "HUG";
  add(a, await txt("① 盤點", "Subtitle/1"));
  for (const [st, l, d] of [
    ["Selected", "沿用 30 分鐘內的盤點", "10:32 · 店內櫃台 · 差異 0"],
    ["Default", "現在盤點", "只盤這個收銀點;被拆開的本只能點格子或掃描"],
    [
      "Default",
      "跳過盤點",
      "需要有跳過盤點的權限;原因必填,報表會標示「未盤點」。",
    ],
  ]) {
    const r = add(a, al("HORIZONTAL", { name: "opt", itemSpacing: 8 }), "FILL");
    add(r, await inst("Draft/Radio", { State: st }));
    const col = add(r, al("VERTICAL", { itemSpacing: 2 }));
    add(col, await txt(l, "Body/1"));
    add(col, await txt(d, "Caption", "text/secondary"));
  }
  const b = add(f, await card("② 兌獎", 10));
  b.resize(560, b.height);
  b.layoutSizingVertical = "HUG";
  const hb = add(
    b,
    al("HORIZONTAL", { itemSpacing: 8, counterAxisAlignItems: "CENTER" }),
    "FILL",
  );
  add(hb, await txt("② 兌獎(本班 3 筆)", "Subtitle/1"));
  spacer(hb);
  add(hb, await btn("補登兌獎", "Outlined", "Small"));
  await kvRows(b, [
    ["09:15  5164-056527-031", "200"],
    ["11:40  5201-001233-077", "500"],
    ["14:02  5150-000981-012", "500"],
  ]);
  await divider(b);
  add(b, await kv("兌獎合計", "1,200", true), "FILL");
  await wrapCaption(
    b,
    "單張超過 5,000 元請到銀行兌獎;超過抽屜目前應有現金時擋下。",
  );
  page.appendChild(f);
  f.x = x0;
  f.y = 1230;
  out.checkout12 = f.id;
}

// ---- 日結(6.10)----
const DSTEPS = ["全店盤點", "期間內各班", "小金庫", "存入銀行", "確認"];
const Y = 2400;
const period = async (content) =>
  add(
    content,
    await inst(
      "Draft/Alert",
      { Severity: "Warning" },
      {
        Message:
          "涵蓋計算期間 10/14 09:02 ~ 現在(10/14、10/15 沒有日結)。不能補日結,這一次會一起涵蓋計算。",
        Action: false,
      },
    ),
    "FILL",
  );
{
  const { s, content } = await pshell(
    "店面管理 / 日結 ② 期間內各班",
    "店面管理",
    "店面管理",
    "日結・中山店",
  );
  await titleRow(content, "日結 · 中山店", "店長 何家華");
  await period(content);
  add(content, await steps(DSTEPS, 1));
  const c = add(content, await card("各班", 0), "FILL");
  const W = [110, 90, 170, 90, 90, 90, 110];
  add(
    c,
    await tableRow(
      ["收銀點", "負責人", "班次", "應有", "實點", "差額", "審核狀態"],
      W,
      true,
    ),
    "FILL",
  );
  for (const [cp, who, t, a, b, d, st, tone] of [
    [
      "店內櫃台",
      "王小明",
      "10/14 08:02–18:05",
      "12,350",
      "12,050",
      "−300",
      "已核准",
      "Success",
    ],
    [
      "店外攤位",
      "陳大文",
      "10/14 13:00–21:00",
      "7,200",
      "7,200",
      "0",
      "已核准",
      "Success",
    ],
    [
      "店內櫃台",
      "李小華",
      "10/15 08:00–18:10",
      "10,880",
      "10,880",
      "0",
      "審核中",
      "Warning",
    ],
    [
      "店內櫃台",
      "王小明",
      "10/16 08:02–15:10",
      "6,420",
      "6,420",
      "0",
      "審核中",
      "Warning",
    ],
  ])
    add(
      c,
      await tableRow([cp, who, t, a, b, d, [await tag(st, tone)]], W, false),
      "FILL",
    );
  add(
    content,
    await txt(
      "交班結帳還在審核中不擋日結;審核中的班在日結單上標示。",
      "Caption",
      "text/secondary",
    ),
  );
  add(
    content,
    await actionsRow([await btn("上一步", "Outlined"), await btn("下一步")]),
    "FILL",
  );
  page.appendChild(s);
  s.x = 0;
  s.y = Y;
  out.day2 = s.id;
}
{
  const { s, content } = await pshell(
    "店面管理 / 日結 ③ 小金庫",
    "店面管理",
    "店面管理",
    "日結・中山店",
  );
  await titleRow(content, "日結 · 中山店", "店長 何家華");
  await period(content);
  add(content, await steps(DSTEPS, 2));
  const cols = add(
    content,
    al("HORIZONTAL", { name: "cols", itemSpacing: 16 }),
    "FILL",
  );
  const L = add(cols, await card("小金庫應有", 8));
  L.resize(520, L.height);
  L.layoutSizingVertical = "HUG";
  add(L, await txt("小金庫應有", "Subtitle/1"));
  await kvRows(L, [
    ["期初(10/13 日結清點)", "20,000"],
    ["投庫(6 筆)", "+ 12,000"],
    ["出庫(3 筆)", "− 3,000"],
    ["調貨(現金)", "0"],
    ["現金更正", "0"],
    ["存銀行(10/15 [存銀行])", "− 5,000"],
  ]);
  await divider(L);
  add(L, await kv("小金庫應有", "24,000", true), "FILL");
  const R = add(cols, await card("小金庫實點", 10), "FILL");
  add(R, await txt("實點(依面額清點)", "Subtitle/1"));
  const dc = await pinst("Draft/DenominationCount");
  add(R, dc, "FILL");
  const rows = dc.findAll((n) => n.name === "row");
  const vals = [
    ["20", "20,000"],
    ["6", "3,000"],
    ["10", "1,000"],
    ["0", "0"],
    ["0", "0"],
    ["0", "0"],
    ["0", "0"],
  ];
  for (let i = 0; i < rows.length; i++) {
    await setProps(
      rows[i].findOne((n) => n.type === "INSTANCE"),
      { Value: vals[i][0] },
    );
    await loadFontsIn(rows[i]);
    rows[i].children[2].findOne((n) => n.type === "TEXT").characters =
      vals[i][1];
  }
  await setText(dc, "12,350", "24,000");
  await divider(R);
  add(R, await kv("差額", "0", true, "success/main"), "FILL");
  add(
    content,
    await actionsRow([await btn("上一步", "Outlined"), await btn("下一步")]),
    "FILL",
  );
  page.appendChild(s);
  s.x = 1560;
  s.y = Y;
  fitHeight(s);
  out.day3 = s.id;
}
{
  const f = al("HORIZONTAL", {
    name: "店面管理 / 日結 ④ 存入銀行 · ⑤ 確認",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 24,
    paddingBottom: 24,
    itemSpacing: 16,
  });
  f.fills = [await paint("bg/default")];
  const a = add(f, await card("④ 存入銀行", 12));
  a.resize(460, a.height);
  a.layoutSizingVertical = "HUG";
  add(a, await txt("④ 存入銀行", "Subtitle/1"));
  add(a, await field("存入金額", "20,000", { width: 200 }), "FILL");
  add(a, await select("存入帳戶", "台灣銀行 中山分行 ****12345", 410), "FILL");
  add(a, await kv("存入後小金庫應有", "4,000"), "FILL");
  await wrapCaption(a, "帳戶只列使用組織包含這家分店、使用中的帳戶。");
  const b = add(f, await card("⑤ 確認", 10));
  b.resize(520, b.height);
  b.layoutSizingVertical = "HUG";
  add(b, await txt("⑤ 確認", "Subtitle/1"));
  await kvRows(b, [
    ["涵蓋計算期間", "10/14 09:02 ~ 現在"],
    ["全店盤點", "現在盤點 · 補登售出 2 張"],
    ["各班差額合計", "− 300", "error/main"],
    ["小金庫差額", "0"],
    ["存入銀行", "20,000 → 台灣銀行 ****12345"],
  ]);
  await wrapCaption(
    b,
    "送出結帳確認申請(類型 = 日結),由店長審核;送出時自動列印日結單(店長簽名)。完成時寫現金流水「存銀行」與銀行「存入」。",
  );
  add(
    b,
    await actionsRow([
      await btn("上一步", "Outlined"),
      await btn("送出結帳確認申請"),
    ]),
    "FILL",
  );
  page.appendChild(f);
  f.x = 3120;
  f.y = Y;
  out.day45 = f.id;
}

// ---- 存銀行(6.11)----
async function depositDialog(name, error) {
  const { ov, dlg } = await overlay(name, 520);
  add(dlg, await txt("存銀行", "Heading/H6"));
  add(
    dlg,
    await txt("中山店 · 小金庫目前應有 24,000", "Body/2", "text/secondary"),
  );
  add(
    dlg,
    await field(
      "金額",
      error ? "30,000" : "5,000",
      error
        ? {
            width: 472,
            state: "Error",
            helper:
              "超過小金庫目前應有金額 24,000。實際的錢比較多時,請先用現金更正單補登。",
          }
        : { width: 472 },
    ),
    "FILL",
  );
  add(
    dlg,
    await select("存入帳戶", "台灣銀行 中山分行 ****12345", 472),
    "FILL",
  );
  add(
    dlg,
    await field("備註", error ? "" : "小金庫現金過多", { width: 472 }),
    "FILL",
  );
  if (error) {
    const pr = add(
      dlg,
      al("HORIZONTAL", {
        name: "print",
        itemSpacing: 12,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    add(pr, await binst("Draft/PrintButton", { State: "Disabled" }));
    add(
      pr,
      await txt(
        "本店未設定印表機,存款單不會列印。",
        "Caption",
        "text/secondary",
      ),
    );
  } else
    await wrapCaption(
      dlg,
      "確認後自動列印存款單(經手人簽名);同時記現金流水「存銀行」與銀行「存入」,不用審核。記錯時到帳戶管理沖正那筆「存入」。",
    );
  add(
    dlg,
    await actionsRow([
      await btn("取消", "Text"),
      await btn(
        "確認存入",
        "Contained",
        "Medium",
        error ? "Disabled" : "Default",
      ),
    ]),
    "FILL",
  );
  page.appendChild(ov);
  ov.y = Y + 1300;
  return ov;
}
out.deposit = (await depositDialog("Overlay / 存銀行", false)).id;
{
  const e = await depositDialog(
    "Overlay / 存銀行(錯誤:超過小金庫應有;本店沒有印表機)",
    true,
  );
  e.x = 1560;
  out.depositError = e.id;
}

// ---- 58mm 單據(12):由底座草稿 Receipt58Row / Receipt58Signature 組成 ----
async function receipt(name, title, rows, sigs) {
  const r = al("VERTICAL", {
    name,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 16,
    itemSpacing: 6,
  });
  r.fills = [await paint("common/white")];
  r.counterAxisSizingMode = "FIXED";
  r.resize(384, 100);
  r.primaryAxisSizingMode = "AUTO";
  for (const [t, st] of [
    ["好運彩券行", "Subtitle/1"],
    [title, "Heading/H6"],
  ]) {
    const x = add(r, await txt(t, st, "grey/900"));
    x.textAlignHorizontal = "CENTER";
    x.layoutSizingHorizontal = "FILL";
  }
  for (const [l, v] of rows)
    add(
      r,
      await binst("Draft/Receipt58Row", {}, { Label: l, Value: v }),
      "FILL",
    );
  for (const s of sigs)
    add(r, await binst("Draft/Receipt58Signature", {}, { Role: s }), "FILL");
  page.appendChild(r);
  r.y = Y + 1300;
  return r;
}
{
  const a = await receipt(
    "58mm / 交班結帳單",
    "交班結帳單",
    [
      ["收銀點", "店內櫃台"],
      ["班次", "10/16 08:02–15:10"],
      ["交班人", "王小明"],
      ["接班人", "李小華"],
      ["盤點", "沿用 10:32"],
      ["應有現金", "12,350"],
      ["實點", "12,050"],
      ["差額", "−300(找錯錢)"],
      ["留給下一班", "3,000"],
      ["單號", "CK-20261016-003"],
    ],
    ["交班人", "接班人"],
  );
  a.x = 3120;
  const b = await receipt(
    "58mm / 存款單",
    "存款單",
    [
      ["分店", "中山店"],
      ["時間", "2026-10-16 15:20"],
      ["經手人", "王小明"],
      ["存入帳戶", "台灣銀行 ****12345"],
      ["金額", "5,000"],
      ["備註", "小金庫現金過多"],
    ],
    ["經手人"],
  );
  b.x = 3560;
  out.receiptCheckout = a.id;
  out.receiptDeposit = b.id;
}
return out;
