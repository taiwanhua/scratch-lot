// 「Screen / 店面管理」第二輪 PART D:頁內分頁的列表、單據檢視頁與新增頁(ST-27~33)。
// 前置:`const PROJECT = true;` + ../_kit.js + store2.js 的 storeShell + 本檔。
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("65:14"));
const Y = await rowY("第二輪:分頁列表與單據(ST-27~33)");
// 單據檢視頁的表頭(引擎零件,唯讀)
async function docHead(sh, no, form, status, tone, who, when) {
  const c = add(sh.content, await card("doc-head", 8), "FILL");
  const r = add(c, H(12), "FILL");
  await put(r, [
    await T(`${form} ${no}`, "Heading/H6"),
    await tag(status, tone),
  ]);
  spacer(r);
  add(r, await btn("列印", "Outlined"));
  add(c, await T(`申請人 ${who} · 送出 ${when}`, "Body/2", "text/secondary"));
  return c;
}
async function review(sh, steps, btns) {
  const c = add(sh.content, await card("review(審核區塊)", 10), "FILL");
  add(c, await T("審核", "Subtitle/1"));
  for (const [a, b, tone] of steps) {
    const r = add(c, H(12), "FILL");
    add(r, await tag(a, tone));
    add(r, await T(b));
  }
  if (btns) {
    add(c, await field("審核意見", ""), "FILL");
    add(c, await actions(btns), "FILL");
  }
  return c;
}
// ST-27 班次結帳歷史紀錄
{
  const sh = await storeShell(
    "ST-27 分頁:班次結帳歷史紀錄(列表)",
    "班次結帳歷史紀錄",
  );
  add(
    sh.content,
    await filters([
      await field("期間", "10/01 ~ 10/16", { w: 200 }),
      await select("收銀點", "全部", 160),
      await select("類型", "全部", 140),
      await select("狀態", "待審核", 140),
    ]),
    "FILL",
  );
  add(
    sh.content,
    await table(
      [
        ["單號", 100],
        ["收銀點", 110],
        ["類型", 70],
        ["交班人", 90],
        ["應有", 90],
        ["實點", 90],
        ["差額", 80],
        ["狀態", 100],
      ],
      [
        [
          "C-0042",
          "店內櫃台",
          "交班",
          "李小華",
          "6,500",
          "6,400",
          await red("−100"),
          await tag("待審核", "Warning"),
        ],
        [
          "C-0041",
          "店內櫃台",
          "交班",
          "王小明",
          "8,200",
          "8,200",
          "0",
          await tag("已完成", "Success"),
        ],
        [
          "C-0040",
          "—",
          "日結",
          "王小明",
          "48,200",
          "48,200",
          "0",
          await tag("已完成", "Success"),
        ],
        [
          "C-0039",
          "店外攤位",
          "交班",
          "陳美玲",
          "3,000",
          "3,000",
          "0",
          await tag("已退回", "Error"),
        ],
      ],
      { right: [4, 5, 6], footer: "共 4 筆" },
    ),
    "FILL",
  );
  await cap(
    sh.content,
    "從精靈送出,列表沒有 [+ 新增]。點一列打開結帳確認申請檢視頁。",
  );
  done(sh, Y);
}
// ST-28 結帳確認申請 檢視頁(交班)
{
  const sh = await shell(
    "ST-28a 結帳確認申請 檢視頁(交班)",
    "店面管理",
    "店面管理",
    "C-0042 結帳確認申請",
  );
  await docHead(
    sh,
    "C-0042",
    "結帳確認申請 · 交班",
    "待審核",
    "Warning",
    "李小華",
    "10/16 22:10",
  );
  const body = add(
    sh.content,
    H(16, { name: "body", counterAxisAlignItems: "MIN" }),
    "FILL",
  );
  const l = add(body, await card("checkout-detail", 6), "FILL");
  add(l, await T("結帳單", "Subtitle/1"));
  for (const [k, x] of [
    ["收銀點", "店內櫃台"],
    ["盤點", "沿用 21:40 全店盤點 S-0032"],
    ["期初零用金", "3,000"],
    ["銷售(42 筆)", "+ 6,900"],
    ["兌獎(3 筆)", "− 400"],
    ["投庫 #D-0018", "− 3,000"],
  ])
    add(l, await kv(k, x), "FILL");
  add(l, await kv("應有", "6,500", { strong: true }), "FILL");
  add(l, await kv("實點", "6,400", { strong: true }), "FILL");
  add(l, await kv("差額", "−100 · 找錯錢", { color: "error/main" }), "FILL");
  add(l, await kv("留給下一班 / 接班人", "0 / (沒有接班人)"), "FILL");
  await cap(l, "每一項可以點開原本的單據。");
  const r = add(body, (await node("Denomination")).createInstance());
  // 面額清點對上實點 6,400
  {
    const D = [1000, 500, 100, 50, 10, 5, 1];
    const cnt = [5, 2, 3, 1, 4, 2, 0];
    await fonts(r);
    const ts = r.findAll((x) => x.type === "TEXT");
    let k = 0;
    for (let i = 0; i < ts.length; i++)
      if (ts[i].name === "value") {
        ts[i].characters = String(cnt[k]);
        ts[i + 2].characters = (D[k] * cnt[k]).toLocaleString("en-US");
        k++;
      }
    ts[ts.length - 1].characters = "6,400";
  }
  await review(
    sh,
    [
      ["已送出", "李小華 22:10"],
      ["待審核", "店長限定「中山店」(沒有接班人,改由店長審核)", "Warning"],
    ],
    [await btn("退回", "Outlined", "Error"), await btn("核准")],
  );
  await cap(sh.content, "駁回、作廢一律擋下,只能退回。核准後套用盤點結果。");
  done(sh, Y);
}
// ST-29 盤點紀錄
{
  const sh = await storeShell("ST-29 分頁:盤點紀錄(列表)", "盤點紀錄");
  add(
    sh.content,
    await filters([
      await field("期間", "10/01 ~ 10/16", { w: 200 }),
      await select("類型", "全部", 140),
      await select("狀態", "全部", 140),
    ]),
    "FILL",
  );
  add(
    sh.content,
    await table(
      [
        ["單號", 100],
        ["類型", 70],
        ["盤點時間", 140],
        ["補登售出", 110],
        ["新增待查", 90],
        ["確認遺失", 90],
        ["狀態", 110],
      ],
      [
        [
          "S-0032",
          "臨時",
          "10/16 21:40",
          "2 張 · 300",
          "1",
          "1",
          await tag("待核准", "Warning"),
        ],
        [
          "S-0031",
          "日結",
          "10/13 22:05",
          "0",
          "0",
          "0",
          await tag("已確認", "Success"),
        ],
        [
          "S-0030",
          "交班",
          "10/13 14:00",
          "2 張 · 400",
          "0",
          "0",
          await tag("已確認", "Success"),
        ],
      ],
      { right: [3, 4, 5], footer: "共 3 筆" },
    ),
    "FILL",
  );
  done(sh, Y);
}
// ST-30 盤點確認申請 檢視頁
{
  const sh = await shell(
    "ST-30 盤點確認申請 檢視頁",
    "店面管理",
    "店面管理",
    "S-0032 盤點確認申請",
  );
  await docHead(
    sh,
    "P-0012",
    "盤點確認申請",
    "待核准",
    "Warning",
    "王小明",
    "10/16 22:02",
  );
  add(
    sh.content,
    await table(
      [
        ["本", 220],
        ["收銀點", 110],
        ["方式", 80],
        ["系統", 60],
        ["實盤", 60],
        ["差異張號", 90],
        ["處理", 160],
      ],
      [
        [
          "5198 鼠來寶 · 088102",
          "店內櫃台",
          "點格子",
          "35",
          "33",
          "#071、#088",
          "補登售出 1、待查 1",
        ],
        [
          "5164 發大財 · 056528",
          "店外攤位",
          "掃描",
          "35",
          "34",
          "#090",
          "補登售出(事後更正)",
        ],
        [
          "5201 金好運 · 060112",
          "店內櫃台",
          "點格子",
          "35",
          "36",
          "#045",
          await tag("標記異常", "Error"),
        ],
      ],
      { right: [3, 4, 5] },
    ),
    "FILL",
  );
  const s = add(sh.content, await card("summary", 6), "FILL");
  for (const [l, v] of [
    ["補登售出", "2 張 · 300 元"],
    ["新增待查", "1 張(#088)+ 1 本(088103)"],
    ["標記異常", "1 張(#045)"],
    ["確認遺失", "1 張 · 批購成本 184"],
  ])
    add(s, await kv(l, v), "FILL");
  await review(
    sh,
    [
      ["已送出", "王小明 22:02"],
      ["待審核", "店長限定「中山店」;申請人是審核者時自動通過", "Warning"],
    ],
    [await btn("退回", "Outlined", "Error"), await btn("核准")],
  );
  done(sh, Y);
}
// ST-31 撤銷售出:列表 + 新增頁
{
  const sh = await storeShell("ST-31a 分頁:撤銷售出(列表)", "撤銷售出");
  add(
    sh.content,
    await titleRow("撤銷售出申請", null, [await btn("+ 新增")]),
    "FILL",
  );
  add(
    sh.content,
    await table(
      [
        ["單號", 100],
        ["張數", 220],
        ["原因", 120],
        ["退款", 90],
        ["退款班次", 160],
        ["狀態", 100],
      ],
      [
        [
          "R-008",
          "5164 #031~032(2 張)",
          "客人退貨",
          "400",
          "店內櫃台 · 李小華",
          await tag("審核中", "Warning"),
        ],
        [
          "R-007",
          "5201 #010(1 張)",
          "盤點錯誤",
          "—",
          "—",
          await tag("已完成", "Success"),
        ],
      ],
      { right: [3] },
    ),
    "FILL",
  );
  done(sh, Y);
  const n = await shell(
    "ST-31b 撤銷售出申請 新增頁",
    "店面管理",
    "店面管理",
    "新增撤銷售出申請",
  );
  const c = add(n.content, await card("form", 14), "FILL");
  add(
    c,
    await grid(
      [
        await select("分店", "中山店", null),
        await select("原因", "客人退貨", null),
      ],
      2,
    ),
    "FILL",
  );
  add(c, await field("刷條碼加入張數", "5164-1-056527-031-0-6"), "FILL");
  add(c, (await node("TicketGrid")).createInstance());
  add(c, await kv("已選", "#031~032(2 張)"), "FILL");
  await put(add(c, H(16)), [
    await T("退款給客人"),
    await radio("是", true),
    await radio("否"),
  ]);
  add(
    c,
    await select("退款班次", "店內櫃台 · 李小華 13:00 開班(目前的班)", 420),
  );
  add(c, await field("說明", "客人刮錯張數"), "FILL");
  add(c, await kv("退款金額", "400", { strong: true }), "FILL");
  await cap(
    c,
    "只能選本店已售、不在其他未結束撤銷單上的張數。送出後張數鎖定,盤點時標示「撤銷審核中」;送出時列印退貨退款收據(標示「待核准」)。",
  );
  add(
    n.content,
    await actions([await btn("送出並列印收據")], [await btn("取消", "Text")]),
    "FILL",
  );
  done(n, Y);
}
// ST-32 現金更正:列表 + 新增頁
{
  const sh = await storeShell("ST-32a 分頁:現金更正(列表)", "現金更正");
  add(
    sh.content,
    await titleRow("現金更正單", null, [await btn("+ 新增")]),
    "FILL",
  );
  add(
    sh.content,
    await table(
      [
        ["單號", 100],
        ["方向", 100],
        ["金額", 90],
        ["位置", 160],
        ["歸屬班次", 160],
        ["原因", 120],
        ["狀態", 100],
      ],
      [
        [
          "X-012",
          "現金增加",
          "500",
          "店內櫃台 · 這一班",
          "—",
          "客人補付",
          await tag("審核中", "Warning"),
        ],
        [
          "X-011",
          "現金減少",
          "1,000",
          "小金庫",
          "店外攤位 10/12 陳美玲",
          "假鈔",
          await tag("已完成", "Success"),
        ],
      ],
      { right: [2] },
    ),
    "FILL",
  );
  done(sh, Y);
  const n = await shell(
    "ST-32b 現金更正單 新增頁",
    "店面管理",
    "店面管理",
    "新增現金更正單",
  );
  const c = add(n.content, await card("form", 14), "FILL");
  add(c, await select("分店", "中山店", 320));
  await put(add(c, H(16)), [
    await T("方向"),
    await radio("現金增加", true),
    await radio("現金減少"),
  ]);
  add(
    c,
    await grid(
      [
        await field("金額", "500"),
        await select("位置", "店內櫃台 · 這一班(李小華)", null),
      ],
      2,
    ),
    "FILL",
  );
  add(
    c,
    await grid(
      [
        await select("歸屬班次(選填)", "—", null),
        await select("原因類別", "客人補付", null),
      ],
      2,
    ),
    "FILL",
  );
  add(c, await field("說明(必填)", "客人回來補付少給的 500"), "FILL");
  await cap(
    c,
    "位置:某一班的抽屜或小金庫,預設目前的班;關店後發現的錢一律選小金庫;不能選已關帳月份。歸屬班次只表示是誰的責任,可以選已關帳月份。審核中時,結帳畫面會列出並自動帶入差額原因。",
  );
  add(
    n.content,
    await actions([await btn("送出")], [await btn("取消", "Text")]),
    "FILL",
  );
  done(n, Y);
}
// ST-33 其他申請
{
  const sh = await storeShell("ST-33 分頁:其他申請(引擎預設列表)", "其他申請");
  add(
    sh.content,
    await titleRow("其他申請", "租戶自己綁到店面管理的表單", [
      await btn("+ 新增 ▾"),
    ]),
    "FILL",
  );
  add(
    sh.content,
    await table(
      [
        ["單號", 120],
        ["表單", 180],
        ["申請人", 120],
        ["狀態", 120],
        ["建立時間", 180],
      ],
      [
        [
          "F-0021",
          "設備報修單",
          "李小華",
          await tag("審核中", "Warning"),
          "10/16 10:12",
        ],
        [
          "F-0019",
          "零用金申請",
          "王小明",
          await tag("已完成", "Success"),
          "10/14 09:30",
        ],
      ],
    ),
    "FILL",
  );
  done(sh, Y);
}
return { made };
