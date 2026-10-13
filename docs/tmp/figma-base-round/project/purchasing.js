// 「Screen / 叫貨與進貨」(scratch-lot Screens 69:14)。前置:project/_header.js + project/_screen-helpers.js。
// 依專案規格 8.1 叫貨單、8.2 / 8.3 進貨單與點收、8.4 調貨單、9 收付機制、7.5 張數格子。
PROJ_PAGE = await figma.getNodeByIdAsync("64:14");
let page = figma.root.children.find((p) => p.name === "Screen / 叫貨與進貨");
if (!page) {
  page = figma.createPage();
  page.name = "Screen / 叫貨與進貨";
}
await figma.setCurrentPageAsync(page);
const out = {};
const head = async (content, title, extra = []) => {
  const tr = add(
    content,
    al("HORIZONTAL", {
      name: "title",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(tr, await txt(title, "Heading/H6"));
  for (const x of extra) add(tr, x);
  return tr;
};

// ---- 叫貨單 新增(8.1 替換新增頁)----
{
  const { s, content } = await pshell(
    "叫貨與進貨 / 叫貨單 新增(替換新增頁)",
    "叫貨、採購單",
    "叫貨、採購單",
    "叫貨單・新增",
  );
  spacer(await head(content, "新增叫貨單"));
  const h = add(
    content,
    al("HORIZONTAL", {
      name: "head",
      itemSpacing: 16,
      counterAxisAlignItems: "MAX",
    }),
    "FILL",
  );
  const ots = await binst("Draft/OrgTreeSelect", {
    State: "Closed",
    Mode: "Single",
  });
  add(h, ots);
  await setText(ots, "label", "叫貨分店");
  await setText(ots, "value", "中山店");
  add(h, await field("期望到貨日(選填)", "2026-10-20", { width: 220 }));
  const c = add(content, await card("遊戲清單", 10), "FILL");
  const fl = add(
    c,
    al("HORIZONTAL", {
      name: "filters",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(fl, await field("搜尋遊戲名稱或代號", "", { width: 280 }));
  add(fl, await select("面額", "全部", 140));
  const ck = add(
    fl,
    al("HORIZONTAL", { itemSpacing: 6, counterAxisAlignItems: "CENTER" }),
  );
  add(
    ck,
    await inst("Draft/Checkbox", { State: "Unchecked", Enabled: "True" }),
  );
  add(ck, await txt("只看要叫的", "Body/2"));
  const W = [300, 110, 80, 80, 80, 110, 220];
  const tb = add(c, al("VERTICAL", { name: "table" }), "FILL");
  add(
    tb,
    await tableRow(
      ["遊戲", "目前庫存(張)", "在途(本)", "近 7 天", "近 30 天", "叫幾本", ""],
      W,
      true,
    ),
    "FILL",
  );
  for (const [isNew, name, stock, transit, d7, d30, q, warn] of [
    [true, "5201 金好運 · 200 元", "0", "0", "—", "—", "2"],
    [true, "5198 鼠來寶 · 100 元", "0", "1", "—", "—", "0"],
    [false, "5164 發大財 · 200 元", "35", "0", "42", "180", "1"],
    [false, "5150 好運旺旺 · 500 元", "120", "0", "30", "95", "0"],
    [
      false,
      "5133 招財貓 · 1,000 元",
      "8",
      "0",
      "6",
      "20",
      "2",
      "超過預計要給本數(1)",
    ],
  ]) {
    const g = [];
    if (isNew) g.push(await tag("新", "Primary"));
    g.push(await cellT(name, true));
    add(
      tb,
      await tableRow(
        [
          g,
          stock,
          transit,
          d7,
          d30,
          [await field("", q, { width: 90 })],
          warn ? [await tag(warn, "Warning")] : [],
        ],
        W,
        false,
      ),
      "FILL",
    );
  }
  await wrapCaption(
    c,
    "上市 30 天內的新遊戲排最上面並標「新」;其他依近 30 天賣出由多到少。新遊戲的銷售欄顯示「—」(還沒賣過)。目前庫存 = 未拆的本 + 檯面上的張數;在途 = 待購買的叫貨 + 已建立但還沒點收完成的進貨單 / 調貨單。叫幾本填 0 的列不會寫入;超過預計要給本數只提醒。",
  );
  const ft = add(
    content,
    al("HORIZONTAL", {
      name: "footer",
      itemSpacing: 16,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  spacer(ft);
  add(ft, await txt("共叫 5 本,預估批購 101,200 元", "Subtitle/1"));
  add(ft, await btn("送出"));
  page.appendChild(s);
  fitHeight(s);
  out.requisitionCreate = s.id;
}

// ---- 進貨單 點收(8.2 替換檢視頁:引擎零件唯讀 + 點收 + SettlementPanel + 審核)----
{
  const { s, content } = await pshell(
    "叫貨與進貨 / 進貨單 點收(替換檢視頁)",
    "進貨單",
    "進貨單",
    "進貨單・P-20261013-001",
  );
  const tr = await head(content, "進貨單 P-20261013-001", [
    await tag("審核中", "Warning"),
  ]);
  spacer(tr);
  add(tr, await binst("Draft/PrintButton", { State: "Default" }));
  add(tr, await btn("退回", "Outlined"));
  add(tr, await btn("駁回", "Outlined", "Medium", "Default", "Error"));
  add(tr, await btn("核准", "Contained", "Medium", "Disabled"));
  add(
    content,
    await inst(
      "Draft/Alert",
      { Severity: "Info" },
      {
        Message:
          "還有 1 本沒點收;核准前要全部點收。刷到的最後張號和單上不同時會擋下,請退回更正。",
        Action: false,
      },
    ),
    "FILL",
  );
  const info = add(content, await card("單據內容(唯讀)", 8), "FILL");
  add(info, await txt("單據內容", "Subtitle/1"));
  const grid = add(
    info,
    al("HORIZONTAL", { name: "grid", itemSpacing: 32 }),
    "FILL",
  );
  const colA = add(grid, al("VERTICAL", { itemSpacing: 6 }), "FILL");
  const colB = add(grid, al("VERTICAL", { itemSpacing: 6 }), "FILL");
  for (const [k, v] of [
    ["進貨分店", "中山店"],
    ["叫貨單", "R-20261012-004"],
    ["批購甲類", "陳甲(證號 12345678)"],
  ])
    add(colA, await kv(k, v), "FILL");
  for (const [k, v] of [
    ["本人批購", "否 · 受託人 林受託"],
    ["批購日期", "2026-10-13"],
    ["扣款帳戶", "台灣銀行 中山分行 ****12345"],
  ])
    add(colB, await kv(k, v), "FILL");
  const rc = add(content, await card("點收", 10), "FILL");
  const rh = add(
    rc,
    al("HORIZONTAL", { itemSpacing: 12, counterAxisAlignItems: "CENTER" }),
    "FILL",
  );
  add(rh, await txt("點收", "Subtitle/1"));
  spacer(rh);
  add(rh, await field("刷條碼點收", "", { width: 320, state: "Focused" }));
  const W = [120, 90, 80, 110, 110, 110, 110];
  const grp = async (title, rows) => {
    add(rc, await txt(title, "Subtitle/2", "text/secondary"));
    add(
      rc,
      await tableRow(
        [
          "本號",
          "最後張號",
          "張數",
          "整本金額",
          "批購金額率",
          "批購金額",
          "點收",
        ],
        W,
        true,
      ),
      "FILL",
    );
    for (const [no, last, n, face, rate, cost, ok] of rows)
      add(
        rc,
        await tableRow(
          [
            no,
            last,
            n,
            face,
            rate,
            cost,
            [await tag(ok ? "已點收" : "未點收", ok ? "Success" : "Grey")],
          ],
          W,
          false,
        ),
        "FILL",
      );
  };
  await grp("5164 發大財 · 200 元 · 叫貨 5,已刷 4", [
    ["056527", "099", "100", "20,000", "92%", "18,400", true],
    ["056528", "099", "100", "20,000", "92%", "18,400", true],
    ["056529", "099", "100", "20,000", "92%", "18,400", true],
    ["056530", "101", "102", "20,400", "92%", "18,768", true],
    ["056531", "099", "100", "20,000", "92%", "18,400", false],
  ]);
  await grp("5201 金好運 · 100 元 · 叫貨 1,已刷 1", [
    ["001233", "099", "100", "10,000", "92%", "9,200", true],
  ]);
  const cols = add(
    content,
    al("HORIZONTAL", { name: "cols", itemSpacing: 16 }),
    "FILL",
  );
  const tot = add(cols, await card("合計", 8), "FILL");
  add(tot, await txt("合計", "Subtitle/1"));
  for (const [k, v, st] of [
    ["批購合計", "101,568"],
    ["兌獎金額", "120,000"],
    ["兌獎折抵(取較小者)", "101,568"],
    ["扣款金額", "0", true],
    ["兌獎剩餘 → 兌獎入帳", "18,432"],
  ])
    add(tot, await kv(k, v, st), "FILL");
  await wrapCaption(
    tot,
    "送出時自動記「批貨支出」= 扣款金額(0 元也記);兌獎剩餘另記銀行「兌獎入帳」,連到這張單方便查來源,但不算進待結清。",
  );
  const st = add(cols, await card("結算(SettlementPanel)", 8), "FILL");
  add(st, await txt("結算", "Subtitle/1"));
  add(st, await kv("應付(扣款金額)", "0"), "FILL");
  add(st, await kv("已付淨額", "0"), "FILL");
  add(st, await kv("差額", await tag("已結清", "Success")), "FILL");
  add(
    st,
    await txt(
      "10/13 09:40 批貨支出 0 · 台灣銀行 ****12345(送出時自動)",
      "Caption",
      "text/secondary",
    ),
  );
  const sb = add(st, al("HORIZONTAL", { itemSpacing: 8 }), "FILL");
  add(sb, await btn("付款", "Outlined", "Small"));
  add(sb, await btn("收到退款", "Outlined", "Small"));
  add(sb, await btn("沖正", "Text", "Small"));
  page.appendChild(s);
  s.x = 1560;
  fitHeight(s);
  out.purchaseReceive = s.id;
}

// ---- 調貨單 新增(8.4 替換新增頁:張數格子 + 刷條碼加入選取)----
{
  const { s, content } = await pshell(
    "叫貨與進貨 / 調貨單 新增(選張)",
    "調貨單",
    "調貨單",
    "調貨單・新增",
  );
  spacer(await head(content, "新增調貨單"));
  const h = add(
    content,
    al("HORIZONTAL", {
      name: "head",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(h, await select("出貨分店", "中山店", 200));
  add(h, await txt("→", "Subtitle/1", "text/secondary"));
  add(h, await select("收貨分店", "民生店", 200));
  add(h, await select("叫貨單(選填)", "R-20261014-002 · 民生店", 280));
  const cols = add(
    content,
    al("HORIZONTAL", { name: "cols", itemSpacing: 16 }),
    "FILL",
  );
  const L = add(cols, await card("調貨明細", 8), "FILL");
  const lh = add(
    L,
    al("HORIZONTAL", { itemSpacing: 12, counterAxisAlignItems: "CENTER" }),
    "FILL",
  );
  add(lh, await txt("調貨明細", "Subtitle/1"));
  spacer(lh);
  add(lh, await field("刷條碼加入選取", "", { width: 220 }));
  const W = [84, 58, 40, 120, 36, 54, 40, 60];
  const rows = [
    await tableRow(
      ["遊戲", "本", "方式", "張號", "張數", "金額", "費率", "批購金額"],
      W,
      true,
    ),
    await tableRow(
      [
        "5164 發大財",
        "056527",
        "選張",
        "#012~016、#020",
        "6",
        "1,200",
        "92%",
        "1,104",
      ],
      W,
      false,
    ),
    await tableRow(
      [
        "5201 金好運",
        "001233",
        "整本",
        "#000~099",
        "100",
        "10,000",
        "92%",
        "9,200",
      ],
      W,
      false,
    ),
  ];
  for (const r of rows) {
    r.itemSpacing = 8;
    add(L, r, "FILL");
  }
  add(L, await kv("調貨金額(批購金額合計)", "10,304", true), "FILL");
  await wrapCaption(
    L,
    "只有拆過的本能選張(需要「零碎張數」權限);整本 = 整本金額,選張 = 面額 × 張數。批購金額率預設這一本的成本率,可逐本或整組改。送出後選取的張鎖定為「調貨中」,不能賣。",
  );
  add(cols, await pinst("Draft/TicketGrid"));
  add(
    content,
    await actionsRow([await btn("儲存草稿", "Outlined"), await btn("送出")]),
    "FILL",
  );
  page.appendChild(s);
  s.x = 3120;
  fitHeight(s);
  out.transferCreate = s.id;
}
return out;
