// 第二輪「Screen / 店面管理」(65:14):專案規格 16.1 的 ST 畫面。
// 前置:`const PROJECT = true; const PART = "A" | "B" | "C" | "D";` + ../_kit.js + 本檔。一次一段。
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("65:14"));
// ---- 店面管理專用 ----
// 店面管理頁的殼:分店選擇器、本機收銀點、連線狀態、上次日結、[盤點] [存銀行] [日結] + 頁內分頁
async function storeShell(name, tab = "看板", o = {}) {
  const sh = await shell(name, "店面管理", "店面管理", "店面管理");
  const top = add(
    sh.content,
    H(12, { name: "store-top", counterAxisAlignItems: "MAX" }),
    "FILL",
  );
  await put(top, [
    await select("分店", "中山店", 220),
    await select("本機收銀點", o.local || "店內櫃台", 180),
  ]);
  const dot = H(6, { name: "conn" });
  const d = figma.createEllipse();
  d.resize(8, 8);
  d.fills = [await paint("success/main")];
  add(dot, d);
  add(dot, await T("即時", "Caption", "text/secondary"));
  add(top, dot);
  spacer(top);
  await put(top, [
    await T("上次日結:10/13(已 3 天)", "Body/2", "warning/main"),
    await btn("盤點", "Outlined"),
    await btn("存銀行", "Outlined"),
    await btn("日結"),
  ]);
  add(
    sh.content,
    await tabs(
      [
        "看板",
        "班次結帳歷史紀錄",
        "盤點紀錄",
        "撤銷售出",
        "現金更正",
        "其他申請",
      ],
      tab,
    ),
    "FILL",
  );
  return sh;
}
// 一個遮罩裡並排多個對話框(同一動作的不同情況)
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
// 票的資訊列(遊戲、面額、本號、張號)
async function ticketInfo(
  game = "5164 發大財",
  price = "200 元",
  book = "056527",
  no = "012",
  where,
) {
  const c = V(4, {
    name: "ticket-info",
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 10,
  });
  c.fills = [await paint("bg/default")];
  await rad(c, "radius/sm");
  const r = add(c, H(8), "FILL");
  add(r, await T(game, "Subtitle/1"));
  spacer(r);
  add(r, await T(price, "Body/2", "text/secondary"));
  add(
    c,
    await T(
      `本號 ${book} · 張號 ${no}${where ? " · " + where : ""}`,
      "Body/2",
      "text/secondary",
    ),
  );
  return c;
}
async function scanField(
  label = "刷條碼或輸入背面編號",
  value = "5164-1-056527-012-0-6",
) {
  return field(label, value);
}

if (PART === "A") {
  const Y = await rowY("第二輪:看板上的動作(ST-02~12)");
  // ST-02 看板:沒有本機收銀點 / 沒有開班
  {
    const sh = await storeShell(
      "ST-02 看板:沒有設定本機收銀點(只能查看)",
      "看板",
      { local: "未設定" },
    );
    add(
      sh.content,
      await alert(
        "這台裝置還沒設定本機收銀點:刷到票只顯示票的資訊,不能銷售、兌獎。[設定本機收銀點]",
        "Warning",
      ),
      "FILL",
    );
    add(
      sh.content,
      await alert(
        "另一種情況:本機收銀點「店內櫃台」沒有開班 → 同樣只能查看,標題列只顯示 [開班]。",
        "Info",
      ),
      "FILL",
    );
    add(
      sh.content,
      await vi(await node("CashPointHeader"), { State: "Closed" }),
      "FILL",
    );
    const info = add(sh.content, await card("scan-info(刷到票時)", 10), "FILL");
    add(info, await T("刷到的票(只顯示資訊)", "Subtitle/1"));
    add(
      info,
      await ticketInfo(
        "5164 發大財",
        "200 元",
        "056527",
        "012",
        "在 店內櫃台 檯面 · 未售",
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // ST-03 設定本機收銀點
  {
    const { ov, dlg } = await overlay("ST-03 Overlay / 設定本機收銀點", 440);
    await dhead(dlg, "設定本機收銀點");
    await cap(dlg, "這台裝置在哪個收銀點收錢。存在這台瀏覽器,不跟帳號走。");
    for (const [l, on] of [
      ["店內櫃台", true],
      ["店外攤位", false],
      ["彩券機旁", false],
    ])
      add(dlg, await radio(l, on));
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("儲存")]),
      "FILL",
    );
    done({ ov }, Y);
  }
  // ST-04 開班
  {
    const { ov, row, fin } = await ovRow(
      "ST-04 Overlay / 開班(期初零用金、對應排班、崗位不一致)",
    );
    const a = await dcard(row, "開班 · 店內櫃台", 480);
    add(a, await kv("期初零用金", "3,000", { strong: true }), "FILL");
    await cap(
      a,
      "來源:今天的第一班 = 出庫單 #W-0012(開班零用金);其他班 = 上一班「留給下一班」。",
    );
    add(
      a,
      await select("對應排班", "王小明 08:00–16:00 · 櫃台 · 負責人", null),
      "FILL",
    );
    await cap(
      a,
      "系統依時間找到的排班,可以改選;找不到時標示「未對應排班」;不能選已關帳月份。",
    );
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("開班")]),
      "FILL",
    );
    const b = await dcard(row, "開班 · 店外攤位", 480);
    add(b, await kv("期初零用金", "2,000", { strong: true }), "FILL");
    await cap(b, "來源:上一班「留給下一班」(陳大文 13:00 交班)。");
    add(
      b,
      await select("對應排班", "李小華 13:00–21:00 · 櫃台 · 協同", null),
      "FILL",
    );
    add(
      b,
      await alert(
        "崗位不一致:排班是「櫃台」,這個收銀點對應的崗位是「攤位」。仍可開班,會記下提醒。",
        "Warning",
      ),
      "FILL",
    );
    add(
      b,
      await actions([await btn("取消", "Text"), await btn("仍要開班")]),
      "FILL",
    );
    const c = await dcard(row, "開班 · 彩券機旁", 480);
    add(c, await select("對應排班", "未對應排班", null, "Error"), "FILL");
    await cap(c, "找不到排班時仍可開班,報表標示「未對應排班」。");
    add(
      c,
      await actions([await btn("取消", "Text"), await btn("開班")]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  // ST-05 刷到票的各種情況
  {
    const { ov, row, fin } = await ovRow(
      "ST-05 Overlay / 刷到票:店外攤位確認、選遊戲、未拆詢問拆本、擋下、尋回",
    );
    const a = await dcard(row, "在別的收銀點", 360);
    add(
      a,
      await ticketInfo("5164 發大財", "200 元", "056527", "012", "店外攤位"),
      "FILL",
    );
    await para(a, "這張票在店外攤位,確定在店內櫃台售出?");
    await cap(a, "確認後寫「移櫃」+「售出」,錢算在本機收銀點這一班。");
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("確定售出")]),
      "FILL",
    );
    const b = await dcard(row, "選擇遊戲", 360);
    await para(b, "本號 056527 在本店對到兩款遊戲:");
    add(b, await radio("5164 發大財 · 200 元", true));
    add(b, await radio("5201 金好運 · 200 元"));
    add(
      b,
      await actions([await btn("取消", "Text"), await btn("售出")]),
      "FILL",
    );
    const c = await dcard(row, "這本還沒拆", 360);
    add(
      c,
      await ticketInfo(
        "5133 招財貓",
        "1,000 元",
        "071204",
        "003",
        "庫存 · 未拆",
      ),
      "FILL",
    );
    await para(c, "要拆本並售出這一張嗎?");
    add(c, await select("拆到哪個收銀點", "店內櫃台(本機)", null), "FILL");
    add(
      c,
      await actions([await btn("取消", "Text"), await btn("拆本並售出")]),
      "FILL",
    );
    const d = await dcard(row, "不能售出", 360);
    add(d, await ticketInfo("5164 發大財", "200 元", "056527", "020"), "FILL");
    add(d, await alert("這張已售出(10/14 15:22 店內櫃台)", "Error"), "FILL");
    await cap(
      d,
      "其他擋下原因:不是本店的票、瑕疵、報廢、被調貨單 #T-0008 鎖定。",
    );
    add(d, await actions([await btn("知道了")]), "FILL");
    const e = await dcard(row, "這本在待查", 360);
    add(
      e,
      await ticketInfo(
        "5198 鼠來寶",
        "100 元",
        "088102",
        "045",
        "待查(10/12 調貨在途刪除)",
      ),
      "FILL",
    );
    await para(e, "要尋回這一本嗎?尋回後回到中山店的庫存。");
    add(e, await select("尋回原因", "調貨時夾在別的本裡", null), "FILL");
    await cap(e, "尋回需要有權限;原因必填。");
    add(
      e,
      await actions([await btn("取消", "Text"), await btn("尋回")]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  // ST-06 快速銷售
  {
    const { ov, dlg } = await overlay(
      "ST-06 Overlay / 快速銷售(其他頁面刷到票)",
      420,
    );
    await dhead(dlg, "快速銷售", "庫存管理頁");
    add(
      dlg,
      await ticketInfo(
        "5164 發大財",
        "200 元",
        "056527",
        "012",
        "店內櫃台 · 未售",
      ),
      "FILL",
    );
    add(dlg, await kv("收銀點", "店內櫃台(本機,開班中)"), "FILL");
    add(dlg, await kv("金額", "200", { strong: true }), "FILL");
    add(
      dlg,
      await actions([
        await btn("取消(Esc)", "Text"),
        await btn("確認售出(Enter)"),
      ]),
      "FILL",
    );
    done({ ov }, Y);
  }
  // ST-07 手動標記售出
  {
    const { ov, dlg } = await overlay(
      "ST-07 Overlay / 手動標記售出(點格子)",
      560,
    );
    await dhead(dlg, "標記售出", "5164 發大財 · 本號 056527");
    add(dlg, (await node("TicketGrid")).createInstance(), "FILL");
    add(
      dlg,
      await kv("已選", "#012~016、#020(6 張) · 1,200 元", { strong: true }),
      "FILL",
    );
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("確認售出")]),
      "FILL",
    );
    fitOv(ov, dlg);
    done({ ov }, Y);
  }
  // ST-08 當下撤銷
  {
    const { ov, dlg } = await overlay(
      "ST-08 Overlay / 當下撤銷 + 超過條件改送撤銷售出申請",
      640,
    );
    await dhead(dlg, "當下撤銷", "只列出你在這一班 30 分鐘內賣出的票");
    add(
      dlg,
      await table(
        [
          ["時間", 80],
          ["票", 220],
          ["金額", 70],
          ["", 150],
        ],
        [
          [
            "15:42",
            "5164 發大財 #012",
            "200",
            await btn("撤銷", "Outlined", "Error", "Default", "Small"),
          ],
          [
            "15:40",
            "5201 金好運 #033",
            "200",
            await btn("撤銷", "Outlined", "Error", "Default", "Small"),
          ],
          ["15:05", "5150 好運旺旺 #008", "500", [await muted("超過 30 分鐘")]],
        ],
        { right: [2] },
      ),
      "FILL",
    );
    add(
      dlg,
      await alert(
        "超過 30 分鐘、這一班已結束,或那張票之後有其他異動:請送「撤銷售出申請」。",
        "Info",
      ),
      "FILL",
    );
    add(
      dlg,
      await actions([
        await btn("關閉", "Text"),
        await btn("送撤銷售出申請", "Outlined"),
      ]),
      "FILL",
    );
    done({ ov }, Y);
  }
  // ST-09 拆本
  {
    const { ov, dlg } = await overlay(
      "ST-09 Overlay / 拆本(選收銀點、標註瑕疵)",
      560,
    );
    await dhead(dlg, "拆本");
    add(dlg, await scanField("刷條碼或輸入本號", "5133-071204"), "FILL");
    add(
      dlg,
      await ticketInfo(
        "5133 招財貓",
        "1,000 元",
        "071204",
        "001~025",
        "庫存 · 未拆 · 25 張",
      ),
      "FILL",
    );
    add(dlg, await T("放到哪個收銀點(可以分放)", "Subtitle/2"));
    await put(add(dlg, H(12), "FILL"), [
      await select("收銀點", "店內櫃台(本機)", 220),
      await field("張數", "15", { w: 100 }),
      await T("#001~015"),
    ]);
    await put(add(dlg, H(12), "FILL"), [
      await select("收銀點", "店外攤位", 220),
      await field("張數", "10", { w: 100 }),
      await T("#016~025"),
    ]);
    add(
      dlg,
      await btn("+ 分到其他收銀點", "Text", "Primary", "Default", "Small"),
    );
    add(
      dlg,
      await field("標註瑕疵張號(選填)", "#018", {
        helper: "瑕疵的張不能賣",
      }),
      "FILL",
    );
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("拆本")]),
      "FILL",
    );
    done({ ov }, Y);
  }
  // ST-10 收回、移櫃
  {
    const { ov, row, fin } = await ovRow("ST-10 Overlay / 收回、移櫃");
    const a = await dcard(row, "收回到庫存", 420);
    add(
      a,
      await ticketInfo(
        "5164 發大財",
        "200 元",
        "056527",
        "#065~099",
        "店內櫃台 · 剩 35 張",
      ),
      "FILL",
    );
    add(a, await radio("整本收回(35 張)", true));
    add(a, await radio("只收回部分張數(點格子)"));
    await cap(a, "寫「收回」事件,不需要審核。");
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("收回")]),
      "FILL",
    );
    const b = await dcard(row, "移櫃", 420);
    add(
      b,
      await ticketInfo(
        "5164 發大財",
        "200 元",
        "056527",
        "#065~099",
        "店內櫃台 · 剩 35 張",
      ),
      "FILL",
    );
    add(b, await select("移到", "店外攤位", null), "FILL");
    add(b, await radio("全部 35 張", true));
    add(b, await radio("部分張數(點格子)"));
    await cap(b, "寫「移櫃」事件,不需要審核。");
    add(
      b,
      await actions([await btn("取消", "Text"), await btn("移櫃")]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  // ST-11 兌獎
  {
    const { ov, row, fin } = await ovRow(
      "ST-11 Overlay / 兌獎(含超過 5,000、超過抽屜應有)",
    );
    const a = await dcard(row, "兌獎 · 店內櫃台", 460);
    add(
      a,
      await scanField("刷背面編號(建議)", "5164-1-056527-031-0-6"),
      "FILL",
    );
    add(
      a,
      await ticketInfo("5164 發大財", "200 元", "056527", "031", "本店的票"),
      "FILL",
    );
    add(a, await T("中獎金額", "Subtitle/2"));
    const chips = add(a, H(8, { name: "amount-chips" }));
    for (const [v, on] of [
      ["200", 0],
      ["500", 1],
      ["1,000", 0],
      ["2,000", 0],
    ])
      add(
        chips,
        await btn(
          v,
          on ? "Contained" : "Outlined",
          "Primary",
          "Default",
          "Small",
        ),
      );
    add(a, await field("其他金額", "500"), "FILL");
    add(a, await field("備註", ""), "FILL");
    await cap(a, "錢從這一班的抽屜付出;同一張不能兌兩次。");
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("兌獎 500")]),
      "FILL",
    );
    const b = await dcard(row, "兌獎 · 錯誤", 460);
    add(
      b,
      await field("中獎金額", "10,000", {
        state: "Error",
        helper: "單張超過 5,000 元:請客人到銀行兌獎",
      }),
      "FILL",
    );
    add(
      b,
      await field("中獎金額", "13,000", {
        state: "Error",
        helper: "超過抽屜目前應有現金 12,350",
      }),
      "FILL",
    );
    add(b, await alert("這張已兌過獎(10/13 18:02 店外攤位)", "Error"), "FILL");
    fin();
    done({ ov }, Y);
  }
  // ST-12 投庫、出庫
  {
    const { ov, row, fin } = await ovRow("ST-12 Overlay / 投庫、出庫");
    const a = await dcard(row, "投庫 · 抽屜 → 小金庫", 420);
    add(a, await kv("店內櫃台 應有現金", "12,350"), "FILL");
    add(a, await field("金額", "5,000"), "FILL");
    add(a, await field("備註", ""), "FILL");
    await cap(a, "做完就生效,自動列印 58mm 投庫單(投庫人、見證人簽名)。");
    add(
      a,
      await actions(
        [await dinst("PrintButton", { State: "Default" }), await btn("投庫")],
        [await btn("取消", "Text")],
      ),
      "FILL",
    );
    const b = await dcard(row, "出庫 · 小金庫 → 抽屜", 420);
    add(b, await kv("小金庫 應有", "48,200"), "FILL");
    add(b, await field("金額", "3,000"), "FILL");
    add(b, await select("原因", "開班零用金", null), "FILL");
    await cap(
      b,
      "原因用欄位管理「出庫原因」:開班零用金、補零錢、其他。自動列印出庫單(領取人、見證人簽名)。",
    );
    add(
      b,
      await actions([await btn("出庫")], [await btn("取消", "Text")]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
}
return { made };
