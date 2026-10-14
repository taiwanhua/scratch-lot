// 第二輪:庫存管理(IN)、叫貨與進貨(PU)、帳戶管理(AC)。專案規格 16.2~16.4。
// 前置:`const PROJECT = true; const PART = "IN" | "PU" | "AC";` + ../_kit.js + 本檔。一次一段(一段一頁)。
async function pageOf(name, id) {
  let p = id
    ? await figma.getNodeByIdAsync(id)
    : figma.root.children.find((x) => x.name === name);
  if (!p) {
    p = figma.createPage();
    p.name = name;
  }
  await figma.setCurrentPageAsync(p);
  return p;
}
async function docHead(sh, title, status, tone, sub, right = []) {
  const c = add(sh.content, await card("doc-head", 8), "FILL");
  const r = add(c, H(12), "FILL");
  await put(r, [await T(title, "Heading/H6"), await tag(status, tone)]);
  spacer(r);
  for (const x of right) add(r, x);
  if (sub) add(c, await T(sub, "Body/2", "text/secondary"));
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
  if (btns) add(c, await actions(btns), "FILL");
  return c;
}
async function ovRow(name) {
  const ov = figma.createFrame();
  ov.name = name;
  ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
  ov.clipsContent = true;
  const row = H(24, {
    name: "dialogs",
    counterAxisAlignItems: "MIN",
    paddingLeft: 64,
    paddingRight: 64,
    paddingTop: 64,
    paddingBottom: 64,
  });
  ov.appendChild(row);
  return {
    ov,
    row,
    fin: () => {
      ov.resize(Math.max(1440, row.width), Math.max(900, row.height));
      row.x = 0;
      row.y = 0;
    },
  };
}
async function dcard(row, title, w = 440, sub) {
  const d = V(14, {
    name: "dialog:" + title,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  d.fills = [await paint("bg/paper")];
  d.effectStyleId = (await sty("Shadow/Dialog")).id;
  await rad(d);
  add(row, d);
  d.counterAxisSizingMode = "FIXED";
  d.resize(w, 100);
  d.primaryAxisSizingMode = "AUTO";
  await dhead(d, title, sub);
  return d;
}
// 結算區塊(SettlementPanel,進貨 / 調貨檢視頁共用)
async function settlement(parent, o) {
  const c = add(parent, await card("SettlementPanel", 10), "FILL");
  const h = add(c, H(12), "FILL");
  add(h, await T("結算", "Subtitle/1"));
  spacer(h);
  for (const b of o.buttons) add(h, b);
  const g = add(c, H(32), "FILL");
  for (const [k, v, col] of o.sums) {
    const x = add(g, V(2));
    add(x, await T(k, "Caption", "text/secondary"));
    add(x, await T(v, "Subtitle/1", col || "text/primary"));
  }
  add(
    c,
    await table(
      [
        ["時間", 110],
        ["類型", 100],
        ["金額", 80],
        ["帳戶 / 現金", 200],
        ["經手", 80],
        ["", 80],
      ],
      o.rows,
      { right: [2] },
    ),
    "FILL",
  );
  return c;
}

if (PART === "IN") {
  await pageOf("Screen / 庫存管理");
  const Y = await rowY("庫存管理(IN-01~06)");
  const tabsIN = ["庫存", "待查·遺失", "預計要給本數"];
  // IN-01 庫存
  {
    const sh = await shell(
      "IN-01 庫存管理 / 庫存(以本為單位)",
      "庫存管理",
      "庫存管理",
      "庫存管理",
    );
    add(
      sh.content,
      await titleRow("庫存", null, [await btn("查票", "Outlined")]),
      "FILL",
    );
    add(sh.content, await tabs(tabsIN, "庫存"), "FILL");
    add(
      sh.content,
      await filters([
        await select("遊戲", "全部", 180),
        await select("狀態", "檯面中", 160),
        await field("批購日", "10/01 ~ 10/16", { w: 200 }),
        await field("本號", "", { w: 160 }),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["本編號", 110],
          ["遊戲", 140],
          ["面額", 60],
          ["所在分店", 160],
          ["剩餘 / 總張數", 110],
          ["待標註", 70],
          ["批購日", 90],
          ["進貨甲類", 120],
        ],
        [
          [
            "056527",
            "5164 發大財",
            "200",
            "中山店",
            "35 / 100",
            "—",
            "10/12",
            "陳志明 #12345678",
          ],
          [
            "060112",
            "5201 金好運",
            "200",
            "中山店 70 / 新竹店 30",
            "100 / 100",
            await tag("2", "Warning"),
            "10/12",
            "陳志明 #12345678",
          ],
          [
            "088102",
            "5198 鼠來寶",
            "100",
            "中山店",
            "6 / 100",
            "—",
            "10/03",
            "林大同 #87654321",
          ],
          [
            "071204",
            "5133 招財貓",
            "1,000",
            "中山店",
            "25 / 25",
            "—",
            "10/15",
            "林大同 #87654321",
          ],
        ],
        { right: [2, 4], footer: "共 4 本" },
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "篩選條件存在網址;刷到票會開「快速銷售」(這頁沒有宣告掃描用途)。拆開到兩家店的本顯示各店張數。",
    );
    done(sh, Y);
  }
  // IN-02 查票
  {
    const { ov, dlg } = await overlay("IN-02 Overlay / 查票", 460);
    await dhead(dlg, "查票");
    add(
      dlg,
      await field("刷條碼或輸入背面編號", "5164-1-056527-031-0-6"),
      "FILL",
    );
    const t = add(dlg, await card("result", 4, 12), "FILL");
    t.fills = [await paint("bg/default")];
    add(t, await T("5164 發大財 · 本號 056527 · 張號 031", "Subtitle/1"));
    add(
      t,
      await T(
        "中山店 · 店內櫃台 · 已售(10/14 15:22)",
        "Body/2",
        "text/secondary",
      ),
    );
    add(
      dlg,
      await actions(
        [await btn("前往這一本並標亮")],
        [await btn("關閉", "Text")],
      ),
      "FILL",
    );
    done({ ov }, Y);
  }
  // IN-03 本的詳情頁
  {
    const sh = await shell(
      "IN-03 本的詳情頁(張數格子、事件時間軸、來源、成本)",
      "庫存管理",
      "庫存管理",
      "056527",
    );
    await docHead(
      sh,
      "5164 發大財 · 本號 056527",
      "檯面中",
      "Primary",
      "200 元 × 100 張 · 張號 000~099",
      [
        await btn("標註瑕疵", "Outlined"),
        await btn("報廢", "Outlined", "Error"),
        await btn("尋回", "Outlined", "Primary", "Disabled"),
      ],
    );
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    const l = add(body, V(16, { name: "left" }));
    add(l, (await node("TicketGrid")).createInstance());
    const info = add(l, await card("source", 6), "FILL");
    add(info, await T("來源與成本", "Subtitle/1"));
    for (const [k, v] of [
      ["進貨單", "P-0031(10/12 點收)"],
      ["批購甲類", "陳志明 #12345678 · 本人批購"],
      ["批購金額率", "92%"],
      ["批購成本", "18,400"],
    ])
      add(info, await kv(k, v), "FILL");
    const tl = add(body, await card("timeline(事件時間軸)", 8), "FILL");
    add(tl, await T("事件時間軸", "Subtitle/1"));
    for (const [d, e, who] of [
      ["10/12 14:05", "進貨(點收) · 中山店", "王小明"],
      ["10/12 14:20", "拆本 → 店內櫃台 #000~099", "王小明"],
      ["10/13~10/16", "售出 62 張(#000~061)", "多人"],
      ["10/14 09:10", "標註瑕疵 #047", "李小華"],
      ["10/16 18:30", "調出 #090~099 → 新竹店(T-0008,在途)", "王小明"],
    ]) {
      const r = add(tl, H(12, { counterAxisAlignItems: "MIN" }), "FILL");
      const t1 = add(r, await T(d, "Body/2", "text/secondary"));
      t1.resize(100, t1.height);
      t1.textAutoResize = "HEIGHT";
      add(r, await T(e), "FILL").textAutoResize = "HEIGHT";
      add(r, await T(who, "Caption", "text/secondary"));
    }
    done(sh, Y);
  }
  // IN-04 標註瑕疵、尋回、報廢
  {
    const { ov, row, fin } = await ovRow(
      "IN-04 Overlay / 標註瑕疵、尋回、報廢",
    );
    const a = await dcard(row, "標註瑕疵", 400);
    add(a, await field("瑕疵張號", "#047、#078"), "FILL");
    await cap(a, "印刷瑕疵的張不能賣。");
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("標註")]),
      "FILL",
    );
    const b = await dcard(row, "尋回", 400);
    add(b, await T("088103 · 5198 鼠來寶(待查)"));
    add(b, await select("尋回原因", "盤點時夾在別的本裡", null), "FILL");
    await cap(b, "回到刷到的那家店的庫存,原因必填。");
    add(
      b,
      await actions([await btn("取消", "Text"), await btn("尋回")]),
      "FILL",
    );
    const c = await dcard(row, "報廢", 400);
    add(c, await field("報廢張號", "#060~064"), "FILL");
    add(c, await select("原因", "受潮", null), "FILL");
    await cap(c, "破損、污損、受潮;報表以批購成本計損失。");
    add(
      c,
      await actions([
        await btn("取消", "Text"),
        await btn("報廢", "Contained", "Error"),
      ]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  // IN-05 待查·遺失
  {
    const sh = await shell(
      "IN-05 庫存管理 / 待查·遺失",
      "庫存管理",
      "庫存管理",
      "庫存管理",
    );
    add(sh.content, await tabs(tabsIN, "待查·遺失"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["本", 110],
          ["遊戲", 140],
          ["狀態", 80],
          ["責任分店", 100],
          ["來源", 260],
          ["日期", 90],
          ["批購成本", 100],
          ["", 90],
        ],
        [
          [
            "056420",
            "5164 發大財",
            await tag("待查", "Warning"),
            "新竹店",
            "調貨單 T-0007 在途的列被刪除",
            "10/12",
            "1,840",
            await btn("尋回", "Text", "Primary", "Default", "Small"),
          ],
          [
            "088103",
            "5198 鼠來寶",
            await tag("待查", "Warning"),
            "中山店",
            "盤點 S-0032:未拆的本不在",
            "10/16",
            "9,200",
            await btn("尋回", "Text", "Primary", "Default", "Small"),
          ],
          [
            "060090",
            "5201 金好運",
            await tag("遺失", "Error"),
            "中山店",
            "盤點確認申請 P-0010 確認遺失",
            "10/05",
            "18,400",
            await btn("尋回", "Text", "Primary", "Default", "Small"),
          ],
        ],
        { right: [6] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // IN-06 預計要給本數
  {
    const sh = await shell(
      "IN-06 庫存管理 / 預計要給本數(分店 × 遊戲)",
      "庫存管理",
      "庫存管理",
      "庫存管理",
    );
    add(sh.content, await tabs(tabsIN, "預計要給本數"), "FILL");
    await cap(
      sh.content,
      "每格「已給 / 預計」;已給 = 進貨 + 調入 − 調出(累計,售出不扣);零碎張數顯示「+N 張」。點格子修改預計。超過只警告。",
    );
    add(
      sh.content,
      await table(
        [
          ["分店", 120],
          ["5164 發大財", 130],
          ["5201 金好運", 130],
          ["5198 鼠來寶", 130],
          ["5133 招財貓", 130],
          ["5150 好運旺旺", 130],
        ],
        [
          [
            "中山店",
            "8 / 10",
            "4 / 6",
            await warn("12 / 10"),
            "2 / 3",
            "5 / 5",
          ],
          [
            "新竹店",
            "3 / 5 +30 張",
            "2 / 4",
            "6 / 8",
            "0 / 2",
            [await field("", "4", { w: 64 }), await T("/ 預計")],
          ],
          ["台中店", "5 / 5", "1 / 3", "4 / 6", "1 / 2", "2 / 4"],
        ],
        { right: [] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
}

if (PART === "PU") {
  await pageOf("Screen / 叫貨與進貨", "69:14");
  const Y = await rowY("第二輪:叫貨與進貨(PU-01、03、04、05、07、08、10)");
  // PU-01 叫貨單 列表
  {
    const sh = await shell(
      "PU-01 叫貨單 列表",
      "叫貨、採購單",
      "叫貨、採購單",
      "叫貨、採購單",
    );
    add(
      sh.content,
      await titleRow("叫貨、採購單", null, [await btn("+ 新增叫貨單")]),
      "FILL",
    );
    add(sh.content, await tabs(["叫貨單", "採購清單"], "叫貨單"), "FILL");
    add(
      sh.content,
      await filters([
        await select("叫貨分店", "全部", 180),
        await select("狀態", "全部", 160),
        await field("期間", "10/01 ~ 10/16", { w: 200 }),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["單號", 100],
          ["叫貨分店", 120],
          ["期望到貨日", 110],
          ["本數", 70],
          ["狀態", 110],
          ["建立者", 100],
        ],
        [
          [
            "R-0023",
            "中山店",
            "10/18",
            "6",
            await tag("審核中", "Warning"),
            "王小明",
          ],
          [
            "R-0022",
            "新竹店",
            "—",
            "3",
            await tag("待購買", "Primary"),
            "陳美玲",
          ],
          [
            "R-0021",
            "中山店",
            "10/16",
            "5",
            await tag("已進貨", "Success"),
            "王小明",
          ],
          [
            "R-0020",
            "台中店",
            "—",
            "2",
            await tag("已調貨", "Success"),
            "林美麗",
          ],
        ],
        { right: [3], footer: "共 4 筆" },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // PU-03 採購清單
  {
    const sh = await shell(
      "PU-03 採購清單(總部)",
      "叫貨、採購單",
      "叫貨、採購單",
      "叫貨、採購單",
    );
    add(
      sh.content,
      await titleRow("叫貨、採購單", null, [
        await btn("匯出 Excel", "Outlined"),
      ]),
      "FILL",
    );
    add(sh.content, await tabs(["叫貨單", "採購清單"], "採購清單"), "FILL");
    await cap(
      sh.content,
      "只列待購買的叫貨單(未作廢、未被進貨單或調貨單引用),依遊戲 × 分店加總。",
    );
    add(
      sh.content,
      await table(
        [
          ["遊戲", 160],
          ["中山店", 90],
          ["新竹店", 90],
          ["台中店", 90],
          ["合計本數", 90],
          ["預估批購金額", 130],
        ],
        [
          ["5201 金好運 200", "2", "1", "—", "3", "55,200"],
          ["5164 發大財 200", "1", "2", "1", "4", "73,600"],
          ["5133 招財貓 1,000", "—", "—", "1", "1", "23,000"],
        ],
        { right: [1, 2, 3, 4, 5] },
      ),
      "FILL",
    );
    add(sh.content, await T("待購買的叫貨單", "Subtitle/1"));
    add(
      sh.content,
      await table(
        [
          ["單號", 100],
          ["叫貨分店", 120],
          ["本數", 70],
          ["預估批購", 110],
          ["", 320],
        ],
        [
          [
            "R-0022",
            "新竹店",
            "3",
            "55,200",
            [
              await btn(
                "建立進貨單",
                "Outlined",
                "Primary",
                "Default",
                "Small",
              ),
              await btn(
                "從其他分店調貨",
                "Text",
                "Primary",
                "Default",
                "Small",
              ),
            ],
          ],
          [
            "R-0019",
            "台中店",
            "2",
            "41,400",
            [
              await btn(
                "建立進貨單",
                "Outlined",
                "Primary",
                "Default",
                "Small",
              ),
              await btn(
                "從其他分店調貨",
                "Text",
                "Primary",
                "Default",
                "Small",
              ),
            ],
          ],
        ],
        { right: [2, 3] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // PU-04 進貨單 列表
  {
    const sh = await shell("PU-04 進貨單 列表", "進貨單", "進貨單", "進貨單");
    add(
      sh.content,
      await titleRow("進貨單", null, [await btn("+ 新增")]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["單號", 90],
          ["進貨分店", 100],
          ["甲類", 140],
          ["批購日", 80],
          ["扣款金額", 100],
          ["點收進度", 90],
          ["結算", 110],
          ["狀態", 100],
        ],
        [
          [
            "P-0032",
            "中山店",
            "陳志明 #12345678",
            "10/16",
            "0",
            "8 / 10",
            "—",
            await tag("審核中", "Warning"),
          ],
          [
            "P-0031",
            "中山店",
            "陳志明 #12345678",
            "10/12",
            "18,400",
            "10 / 10",
            await tag("待退 2,000", "Warning"),
            await tag("已完成", "Success"),
          ],
          [
            "P-0030",
            "新竹店",
            "林大同 #87654321",
            "10/03",
            "36,800",
            "10 / 10",
            "已結清",
            await tag("已完成", "Success"),
          ],
        ],
        { right: [4, 5] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // PU-05 進貨單 新增頁
  {
    const sh = await shell(
      "PU-05 進貨單 新增頁(刷條碼、依遊戲分組、兌獎金額 / 折抵 / 扣款)",
      "進貨單",
      "進貨單",
      "新增進貨單",
    );
    const head = add(sh.content, await card("header", 12), "FILL");
    add(
      head,
      await grid(
        [
          await select("進貨分店", "中山店", null),
          await select("叫貨單", "R-0023(叫貨 5,已刷 4)", null),
          await select("批購甲類", "陳志明 #12345678", null),
          await select("扣款帳戶", "中山店營業戶 · 末 34521", null),
        ],
        4,
      ),
      "FILL",
    );
    const r2 = add(head, H(16, { counterAxisAlignItems: "MAX" }), "FILL");
    await put(r2, [
      await T("本人批購"),
      await radio("是"),
      await radio("否", true),
      await select("批購受託人", "陳小芳", 200),
      await field("批購日期", "2026-10-16", { w: 160 }),
      await field("兌獎金額", "100,000", { w: 160 }),
    ]);
    add(sh.content, await field("刷條碼加入", "5201-1-060113-000-0-2"), "FILL");
    const det = add(
      sh.content,
      await card("details(依遊戲分組)", 0, 0),
      "FILL",
    );
    const grp = async (title, rateField, sub) => {
      const g = add(
        det,
        H(12, {
          name: "group",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 10,
          paddingBottom: 10,
        }),
        "FILL",
      );
      g.fills = [await paint("bg/default")];
      add(g, await T(title, "Subtitle/2"));
      spacer(g);
      add(g, await T("整組批購金額率", "Caption", "text/secondary"));
      add(g, rateField);
      add(g, await T(sub, "Subtitle/2"));
    };
    await grp(
      "5201 金好運 · 200 元 × 100 張",
      await field("", "92", { w: 70 }),
      "小計 55,200",
    );
    add(
      det,
      await table(
        [
          ["本號", 140],
          ["最後張號", 90],
          ["張數", 70],
          ["整本金額", 100],
          ["批購金額率", 130],
          ["批購金額", 110],
        ],
        [
          [
            "060113",
            "099",
            "100",
            "20,000",
            await field("", "92", { w: 70 }),
            "18,400",
          ],
          [
            "060114",
            "099",
            "100",
            "20,000",
            await field("", "92", { w: 70 }),
            "18,400",
          ],
          [
            "060115",
            "100(跳號)",
            "101",
            "20,000",
            [await field("", "92", { w: 70 }), await warn("改過")],
            "18,400",
          ],
        ],
        { right: [2, 3, 5] },
      ),
      "FILL",
    );
    await grp(
      "5164 發大財 · 200 元 × 100 張",
      await field("", "92", { w: 70 }),
      "小計 4,800",
    );
    add(
      det,
      await table(
        [
          ["本號", 140],
          ["最後張號", 90],
          ["張數", 70],
          ["整本金額", 100],
          ["批購金額率", 130],
          ["批購金額", 110],
        ],
        [
          [
            "056529",
            "099",
            "100",
            "20,000",
            await field("", "24", { w: 70 }),
            "4,800",
          ],
        ],
        { right: [2, 3, 5] },
      ),
      "FILL",
    );
    const sum = add(sh.content, await card("totals(系統計算)", 6), "FILL");
    for (const [k, v, o] of [
      ["批購合計", "60,000"],
      ["兌獎金額", "100,000"],
      ["兌獎折抵(兌獎金額與批購合計取較小者)", "60,000"],
      ["扣款金額(記「批貨支出」)", "0", { strong: true }],
      [
        "兌獎剩餘(記銀行「兌獎入帳」,不算待結清)",
        "40,000",
        { strong: true, color: "success/main" },
      ],
    ])
      add(sum, await kv(k, v, o), "FILL");
    add(
      sh.content,
      await actions(
        [await btn("送出")],
        [await btn("取消", "Text"), await muted("超過預計要給本數只警告")],
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // PU-07 進貨單 檢視頁:結算 + 送錯分店
  {
    const sh = await shell(
      "PU-07 進貨單 檢視頁:點收進度、結算區塊",
      "進貨單",
      "進貨單",
      "P-0031",
    );
    await docHead(
      sh,
      "進貨單 P-0031",
      "審核中",
      "Warning",
      "中山店 · 陳志明 #12345678 · 批購 10/12 · 點收 8 / 10",
      [await btn("列印進貨點收單", "Outlined")],
    );
    await settlement(sh.content, {
      buttons: [
        await btn("付款", "Outlined", "Primary", "Default", "Small"),
        await btn("收到退款", "Outlined", "Primary", "Default", "Small"),
      ],
      sums: [
        ["應付(批購合計 − 兌獎折抵)", "16,400"],
        ["已付淨額", "18,400"],
        ["差額", "待退 2,000", "warning/main"],
      ],
      rows: [
        [
          "10/12 14:00",
          "批貨支出",
          "18,400",
          "總部營業戶 · 末 34521",
          "系統",
          "",
        ],
        [
          "10/12 14:00",
          "兌獎入帳",
          "40,000",
          "總部營業戶 · 末 34521",
          "系統",
          await muted("不算待結清"),
        ],
      ],
    });
    await review(
      sh,
      [
        ["已送出", "王小明 10/12 14:00"],
        [
          "點收中",
          "店長限定「中山店」:8 / 10 本已點收;還有沒點收的列時不能核准",
          "Warning",
        ],
      ],
      [
        await btn("退回", "Outlined", "Error"),
        await btn("核准", "Contained", "Primary", "Disabled"),
      ],
    );
    done(sh, Y);
    const { ov, dlg } = await overlay(
      "PU-07 Overlay / 刷到別家分店的進貨單",
      480,
    );
    await dhead(dlg, "這本不是送到這家店");
    add(
      dlg,
      await alert(
        "060116 在進貨單 P-0033 上屬於「新竹店」,不能直接入庫到中山店。",
        "Warning",
      ),
      "FILL",
    );
    add(
      dlg,
      await actions([
        await btn("通知總部更正", "Outlined"),
        await btn("不入庫,轉送新竹店"),
      ]),
      "FILL",
    );
    await cap(dlg, "通知總部更正 = 通知這張進貨單的建立者(底座 B7)。");
    done({ ov }, Y);
  }
  // PU-08 調貨單 列表
  {
    const sh = await shell("PU-08 調貨單 列表", "調貨單", "調貨單", "調貨單");
    add(
      sh.content,
      await titleRow("調貨單", "收貨店不發起調貨單,缺貨請開叫貨單", [
        await btn("+ 新增"),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["單號", 90],
          ["出貨店 → 收貨店", 170],
          ["本數 / 張數", 100],
          ["調貨金額", 100],
          ["點收進度", 90],
          ["結算", 130],
          ["狀態", 110],
        ],
        [
          [
            "T-0008",
            "中山店 → 新竹店",
            "1 本 / 10 張",
            "1,840",
            "0 / 1",
            await tag("待收 1,840", "Warning"),
            await tag("在途", "Primary"),
          ],
          [
            "T-0007",
            "新竹店 → 台中店",
            "2 本",
            "36,800",
            "2 / 2",
            "已結清",
            await tag("已完成", "Success"),
          ],
        ],
        { right: [3] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // PU-10 調貨單 檢視頁:出貨確認 / 點收 + 結算
  {
    const sh = await shell(
      "PU-10a 調貨單 檢視頁:第一關 出貨確認(出貨店)",
      "調貨單",
      "調貨單",
      "T-0008",
    );
    await docHead(
      sh,
      "調貨單 T-0008",
      "第一關 出貨確認",
      "Warning",
      "中山店 → 新竹店 · 叫貨單 R-0022 · 建立 王小明",
      [await btn("列印調貨出貨單", "Outlined")],
    );
    add(
      sh.content,
      await table(
        [
          ["遊戲", 140],
          ["本", 100],
          ["方式", 80],
          ["張號", 140],
          ["張數", 70],
          ["金額", 90],
          ["批購金額率", 100],
          ["批購金額", 100],
        ],
        [
          [
            "5164 發大財",
            "056527",
            "選張",
            "#090~099",
            "10",
            "2,000",
            "92%",
            "1,840",
          ],
        ],
        { right: [4, 5, 7] },
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "出貨店的人送出時自動跳過這一關。通過後:這些張改為「在途」、寫「調出」事件、列印調貨出貨單(出貨人、送貨人、收貨人簽名),通知收貨店店長。",
    );
    await settlement(sh.content, {
      buttons: [
        await btn("收款", "Outlined", "Primary", "Default", "Small"),
        await btn("退款", "Outlined", "Primary", "Default", "Small"),
      ],
      sums: [
        ["調貨金額", "1,840"],
        ["已收淨額", "0"],
        ["待收", "1,840", "warning/main"],
      ],
      rows: [],
    });
    await review(
      sh,
      [
        ["已送出", "王小明 10/16 18:20"],
        ["待審核", "店長限定「中山店」", "Warning"],
      ],
      [await btn("退回", "Outlined", "Error"), await btn("確認出貨")],
    );
    done(sh, Y);
    const s2 = await shell(
      "PU-10b 調貨單 檢視頁:第二關 點收 + 結算(收貨店)",
      "調貨單",
      "調貨單",
      "T-0008",
    );
    await docHead(
      s2,
      "調貨單 T-0008",
      "第二關 點收",
      "Warning",
      "中山店 → 新竹店 · 在途 · 點收 0 / 1",
    );
    add(s2.content, await field("刷條碼點收", "5164-1-056527-090-0-3"), "FILL");
    add(
      s2.content,
      await table(
        [
          ["本", 120],
          ["張號", 140],
          ["張數", 70],
          ["批購金額", 100],
          ["點收", 160],
        ],
        [["056527", "#090~099", "10", "1,840", await tag("待點收")]],
        { right: [2, 3] },
      ),
      "FILL",
    );
    await settlement(s2.content, {
      buttons: [
        await btn("付款", "Contained", "Primary", "Default", "Small"),
        await btn("收到退款", "Outlined", "Primary", "Default", "Small"),
      ],
      sums: [
        ["調貨金額", "1,840"],
        ["已付淨額", "1,840"],
        ["其中對方已付", "現金 1,840,10/16 交給王小明,出貨店尚未入帳"],
      ],
      rows: [
        [
          "10/16 19:05",
          "調貨支出",
          "1,840",
          "現金 · 店內櫃台抽屜(開班中)",
          "陳美玲",
          await btn("沖正", "Text", "Error", "Default", "Small"),
        ],
      ],
    });
    await review(
      s2,
      [
        ["第一關", "已確認出貨 10/16 18:30"],
        [
          "待審核",
          "店長限定「新竹店」:全部點收且已付淨額 = 調貨金額才能核准",
          "Warning",
        ],
      ],
      [
        await btn("退回", "Outlined", "Error"),
        await btn("核准", "Contained", "Primary", "Disabled"),
      ],
    );
    done(s2, Y);
  }
}

if (PART === "AC") {
  await pageOf("Screen / 帳戶管理");
  const Y = await rowY("帳戶管理(AC-01~07)");
  const tabsAC = ["銀行帳戶", "即時現金帳", "待結清款項", "關帳"];
  // AC-01 銀行帳戶 列表
  {
    const sh = await shell(
      "AC-01 帳戶管理 / 銀行帳戶",
      "帳戶管理",
      "帳戶管理",
      "帳戶管理",
    );
    add(
      sh.content,
      await titleRow("帳戶管理", null, [await btn("+ 新增帳戶")]),
      "FILL",
    );
    add(sh.content, await tabs(tabsAC, "銀行帳戶"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["戶名", 180],
          ["銀行 / 分行", 180],
          ["帳號", 100],
          ["使用組織", 200],
          ["餘額", 110],
          ["狀態", 90],
        ],
        [
          [
            "好運彩券行",
            "台灣銀行 · 中山分行",
            "末 34521",
            "最上層組織、中山店",
            "1,284,300",
            await tag("使用中", "Success"),
          ],
          [
            "好運彩券行新竹",
            "土地銀行 · 新竹分行",
            "末 88012",
            "新竹店",
            await T("−2,000", "Body/2", "warning/main"),
            await tag("使用中", "Success"),
          ],
          ["舊帳戶", "郵局", "末 00921", "—", "0", await tag("停用")],
        ],
        { right: [4] },
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "分店的人只看得到使用組織包含自己的帳戶;餘額即時計算,負數只警告。",
    );
    done(sh, Y);
  }
  // AC-02 銀行帳戶 詳情頁
  {
    const sh = await shell(
      "AC-02 銀行帳戶 詳情頁(餘額、交易、使用組織)",
      "帳戶管理",
      "帳戶管理",
      "台灣銀行 末 34521",
    );
    await docHead(
      sh,
      "好運彩券行 · 台灣銀行 中山分行 末 34521",
      "使用中",
      "Success",
      "使用組織:最上層組織、中山店",
      [await btn("設定使用組織", "Outlined"), await btn("登記交易")],
    );
    const bal = add(sh.content, H(16, { name: "balance" }), "FILL");
    for (const [k, v] of [
      ["目前餘額", "1,284,300"],
      ["本月收", "+ 412,000"],
      ["本月支", "− 380,800"],
    ]) {
      const c = add(bal, await card("stat", 4), "FILL");
      add(c, await T(k, "Caption", "text/secondary"));
      add(c, await T(v, "Heading/H6"));
    }
    add(
      sh.content,
      await filters([
        await field("期間", "10/01 ~ 10/16", { w: 200 }),
        await select("類型", "全部", 160),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["時間", 110],
          ["類型", 90],
          ["摘要", 200],
          ["歸屬分店", 90],
          ["收", 90],
          ["支", 90],
          ["餘額", 100],
          ["", 80],
        ],
        [
          [
            "10/16 22:30",
            "存入",
            "日結存入 · C-0040",
            "中山店",
            "48,200",
            "",
            "1,284,300",
            await btn("沖正", "Text", "Error", "Default", "Small"),
          ],
          [
            "10/12 14:00",
            "兌獎入帳",
            "進貨單 P-0031 兌獎剩餘",
            "中山店",
            "40,000",
            "",
            "1,236,100",
            await btn("沖正", "Text", "Error", "Default", "Small"),
          ],
          [
            "10/12 14:00",
            "批貨支出",
            "進貨單 P-0031 · 批購 10/12",
            "中山店",
            "",
            "18,400",
            "1,196,100",
            await btn("沖正", "Text", "Error", "Default", "Small"),
          ],
          [
            "10/05 10:00",
            "牌租",
            "乙類 好運 2 號店 10 月牌租",
            "—",
            "",
            "3,000",
            "1,214,500",
            await muted("已沖正"),
          ],
        ],
        { right: [4, 5, 6] },
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "有交易之後,銀行代碼、帳號、期初餘額、期初日期鎖定。沖正會寫一筆相反方向的交易;連到「存銀行」的存入被沖正時,現金流水自動寫反向紀錄。",
    );
    done(sh, Y);
  }
  // AC-03 新增帳戶、登記交易、沖正
  {
    const { ov, row, fin } = await ovRow(
      "AC-03 Overlay / 新增帳戶、登記交易、沖正",
    );
    const a = await dcard(row, "新增帳戶", 440);
    add(
      a,
      await grid(
        [await field("銀行代碼", "004"), await field("分行", "中山分行")],
        2,
      ),
      "FILL",
    );
    add(a, await field("帳號", "0123-4567-34521"), "FILL");
    add(a, await field("戶名", "好運彩券行"), "FILL");
    add(
      a,
      await grid(
        [
          await field("期初餘額", "1,000,000"),
          await field("期初日期", "2026-10-01"),
        ],
        2,
      ),
      "FILL",
    );
    add(a, (await node("OrgTreeSelect")).children[0].createInstance(), "FILL");
    await cap(
      a,
      "使用組織可以多個;有交易後銀行代碼、帳號、期初餘額、期初日期鎖定。",
    );
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("新增")]),
      "FILL",
    );
    const b = await dcard(row, "登記交易", 440);
    add(b, await select("類型", "批貨收入", null), "FILL");
    add(
      b,
      await select(
        "單據(必填,只列有待退或待收的)",
        "P-0031 進貨單 · 待退 2,000",
        null,
      ),
      "FILL",
    );
    add(
      b,
      await grid(
        [await field("金額", "2,000"), await field("時間", "2026-10-16 15:00")],
        2,
      ),
      "FILL",
    );
    add(b, await select("歸屬分店", "中山店", null), "FILL");
    add(b, await field("摘要", "甲類退回多付款"), "FILL");
    await cap(
      b,
      "調整、其他要選方向且說明必填;還沒有正式類型的收入用「其他」。需要 record-bank-transaction。",
    );
    add(
      b,
      await actions([await btn("取消", "Text"), await btn("登記")]),
      "FILL",
    );
    const c = await dcard(row, "沖正", 440);
    add(c, await kv("原交易", "10/12 批貨支出 18,400"), "FILL");
    add(c, await field("原因(必填)", "金額記錯"), "FILL");
    await cap(
      c,
      "會寫一筆相反方向、同金額的交易,原交易保留。需要 reverse-bank-transaction。",
    );
    add(
      c,
      await actions([
        await btn("取消", "Text"),
        await btn("沖正", "Contained", "Error"),
      ]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  // AC-04 即時現金帳
  {
    const sh = await shell(
      "AC-04 帳戶管理 / 即時現金帳(只能查看)",
      "帳戶管理",
      "帳戶管理",
      "帳戶管理",
    );
    add(sh.content, await tabs(tabsAC, "即時現金帳"), "FILL");
    add(sh.content, await select("分店", "中山店", 220));
    const st = add(sh.content, H(16, { name: "balances" }), "FILL");
    for (const [k, v, s] of [
      ["小金庫", "48,200", "起算:10/13 日結清點"],
      ["店內櫃台 抽屜", "6,500", "開班中 · 李小華"],
      ["店外攤位 抽屜", "3,000", "開班中 · 陳美玲"],
      ["彩券機旁 抽屜", "0", "未開班"],
    ]) {
      const c = add(st, await card("stat", 4), "FILL");
      add(c, await T(k, "Caption", "text/secondary"));
      add(c, await T(v, "Heading/H6"));
      add(c, await T(s, "Caption", "text/secondary"));
    }
    add(
      sh.content,
      await filters([
        await select("類型", "全部", 160),
        await select("收銀點", "全部", 160),
        await field("日期", "10/16", { w: 160 }),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["時間", 90],
          ["類型", 100],
          ["從 → 到", 200],
          ["收銀點", 100],
          ["金額", 90],
          ["單據", 140],
        ],
        [
          ["21:30", "投庫", "抽屜 → 小金庫", "店內櫃台", "3,000", "D-0018"],
          [
            "19:05",
            "調貨支出",
            "抽屜 → 外部(王小明)",
            "店內櫃台",
            "1,840",
            "T-0008",
          ],
          [
            "13:00",
            "出庫",
            "小金庫 → 抽屜(開班零用金)",
            "店外攤位",
            "2,000",
            "W-0013",
          ],
          ["10:20", "存銀行", "小金庫 → 銀行", "—", "20,000", "存款 K-0004"],
        ],
        { right: [4] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // AC-05 待結清款項
  {
    const sh = await shell(
      "AC-05 帳戶管理 / 待結清款項",
      "帳戶管理",
      "帳戶管理",
      "帳戶管理",
    );
    add(sh.content, await tabs(tabsAC, "待結清款項"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["單據", 110],
          ["分店", 90],
          ["對象", 160],
          ["應付", 90],
          ["已付", 90],
          ["差額", 120],
          ["已過天數", 80],
          ["", 180],
        ],
        [
          [
            "P-0031 進貨",
            "中山店",
            "陳志明 #12345678",
            "16,400",
            "18,400",
            await tag("待退 2,000", "Warning"),
            "4",
            await btn("收到退款", "Outlined", "Primary", "Default", "Small"),
          ],
          [
            "T-0008 調貨",
            "新竹店",
            "中山店(出貨店)",
            "1,840",
            "1,840",
            await tag("待收 1,840", "Warning"),
            "0",
            [
              await btn("收款", "Outlined", "Primary", "Default", "Small"),
              await muted("對方已付現"),
            ],
          ],
          [
            "P-0033 進貨",
            "新竹店",
            "林大同 #87654321",
            "36,800",
            "0",
            await tag("待付 36,800", "Error"),
            "1",
            await btn("付款", "Outlined", "Primary", "Default", "Small"),
          ],
        ],
        { right: [3, 4, 6] },
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "進貨與調貨同一頁;按鈕打開與單據檢視頁相同的結算視窗,權限沿用單據的 settle / pay / receive。「兌獎入帳」不算待結清。",
    );
    done(sh, Y);
  }
  // AC-06 / AC-07 關帳
  {
    const sh = await shell(
      "AC-06 帳戶管理 / 關帳(月份列表)",
      "帳戶管理",
      "帳戶管理",
      "帳戶管理",
    );
    add(sh.content, await tabs(tabsAC, "關帳"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["月份", 120],
          ["狀態", 100],
          ["關帳時間", 160],
          ["關帳人", 120],
          ["", 200],
        ],
        [
          ["2026-10", await tag("進行中"), "—", "—", ""],
          [
            "2026-09",
            await tag("未關帳", "Warning"),
            "—",
            "—",
            await btn("關帳", "Contained", "Primary", "Default", "Small"),
          ],
          [
            "2026-08",
            await tag("已關帳", "Success"),
            "2026-09-03 10:12",
            "王總",
            await btn("快照", "Text", "Primary", "Default", "Small"),
          ],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "整個租戶依序關帳;[關帳] 只在最早的未關帳過去月份;永遠關到該月最後一刻;不能重新開帳。上個月的錯誤用原本的功能在現在記錄,報表自動歸到「前期更正」。",
    );
    done(sh, Y);
    const { ov, dlg } = await overlay(
      "AC-07 Overlay / 關帳(檢查清單、快照預覽、輸入月份確認)",
      600,
    );
    await dhead(dlg, "關帳 2026-09");
    for (const [ok2, s] of [
      [1, "所有收銀班次都已結帳"],
      [1, "沒有審核中且會記到 9 月的單據"],
      [0, "每一班都被日結涵蓋計算:新竹店有 2 班沒有(只警告,記入快照)"],
    ]) {
      const r = add(dlg, H(8), "FILL");
      add(
        r,
        await T(
          ok2 ? "✓" : "!",
          "Subtitle/1",
          ok2 ? "success/main" : "warning/main",
        ),
      );
      add(r, await T(s), "FILL").textAutoResize = "HEIGHT";
    }
    const snap = add(dlg, await card("snapshot", 6, 12), "FILL");
    snap.fills = [await paint("bg/default")];
    add(snap, await T("快照預覽", "Subtitle/2"));
    for (const [k, v] of [
      ["台灣銀行 末 34521 月底餘額", "1,102,800"],
      ["土地銀行 末 88012 月底餘額", "86,400"],
      ["中山店 小金庫 / 抽屜", "52,000 / 0"],
      ["新竹店 沒有被日結涵蓋計算的班", "2 班"],
    ])
      add(snap, await kv(k, v), "FILL");
    add(dlg, await field("輸入月份確認", "2026-09"), "FILL");
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("關帳")]),
      "FILL",
    );
    fitOv(ov, dlg);
    done({ ov }, Y);
  }
}
return { made };
