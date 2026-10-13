// 「Screen / 店面管理」(scratch-lot Screens 65:14)。前置:project/_header.js + project/_screen-helpers.js。
// 依專案規格 6.1~6.11、8.7、12。可分段執行(每段一個畫面)。
PROJ_PAGE = await figma.getNodeByIdAsync("64:14");
let page = figma.root.children.find((p) => p.name === "Screen / 店面管理");
if (!page) {
  page = figma.createPage();
  page.name = "Screen / 店面管理";
}
await figma.setCurrentPageAsync(page);
const out = {};

// ---- 看板(6.1 / 6.2)----
{
  const { s, content } = await pshell(
    "店面管理 / 看板",
    "店面管理",
    "店面管理",
    "店面管理",
  );
  const tb = add(
    content,
    al("HORIZONTAL", {
      name: "toolbar",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  const ots = await binst("Draft/OrgTreeSelect", {
    State: "Closed",
    Mode: "Single",
  });
  add(tb, ots);
  await setText(ots, "label", "分店");
  await setText(ots, "value", "中山店");
  add(tb, await select("本機收銀點", "店內櫃台", 180));
  const live = add(
    tb,
    al("HORIZONTAL", {
      name: "realtime",
      itemSpacing: 6,
      counterAxisAlignItems: "CENTER",
    }),
  );
  const dot = figma.createEllipse();
  dot.resize(8, 8);
  dot.fills = [await paint("success/main")];
  live.appendChild(dot);
  add(live, await txt("即時", "Caption", "text/secondary"));
  spacer(tb);
  add(tb, await txt("上次日結:10/13(已 3 天)", "Body/2", "warning/main"));
  add(tb, await btn("存銀行", "Outlined"));
  add(tb, await btn("日結"));
  add(
    content,
    await tabsRow(
      [
        "看板",
        "班次結帳歷史紀錄",
        "盤點紀錄",
        "撤銷售出",
        "現金更正",
        "其他申請",
      ],
      "看板",
    ),
    "FILL",
  );
  add(
    content,
    await inst(
      "Draft/Alert",
      { Severity: "Warning" },
      { Message: "距離上次盤點已超過 24 小時,建議盤點一次。", Action: false },
    ),
    "FILL",
  );
  const lane = async (name, open, local, who, cards, stats) => {
    const l = add(
      content,
      al("VERTICAL", { name: "lane:" + name, itemSpacing: 10 }),
      "FILL",
    );
    const h = await pinst("Draft/CashPointHeader", {
      State: open ? "Open" : "Closed",
    });
    add(l, h, "FILL");
    await setText(h, "name", name);
    if (who) await setText(h, "who", who);
    if (stats) {
      await setText(h, "42 張 / 8,400", stats[0]);
      await setText(h, "12,350", stats[1]);
    }
    if (!local) {
      const t = h
        .findAll((n) => n.type === "INSTANCE")
        .find((n) =>
          n.findOne((x) => x.type === "TEXT" && x.characters === "本機"),
        );
      if (t) t.visible = false;
    }
    if (cards.length) {
      const row = add(
        l,
        al("HORIZONTAL", { name: "cards", itemSpacing: 12 }),
        "FILL",
      );
      for (const [st, g, p] of cards) {
        const c = await pinst("Draft/BoardBookCard", { State: st });
        add(row, c);
        if (g) await setText(c, "game", g);
        if (p) await setText(c, "price", p);
      }
    }
  };
  await lane("店內櫃台", true, true, null, [
    ["Normal"],
    ["Attention", "5201 金好運", "100 元"],
    ["LowStock", "5198 鼠來寶", "100 元"],
    ["Normal", "5150 好運旺旺", "500 元"],
  ]);
  await lane(
    "店外攤位",
    true,
    false,
    "負責人 陳大文 · 13:00 開班",
    [
      ["Normal", "5164 發大財", "200 元"],
      ["Normal", "5133 招財貓", "1,000 元"],
    ],
    ["18 張 / 3,600", "7,200"],
  );
  await lane("彩券機旁", false, false, null, []);
  page.appendChild(s);
  s.x = 0;
  s.y = 0;
  out.board = s.id;
}
// ---- [日結] 停用提示(6.10)----
{
  const f = al("VERTICAL", {
    name: "店面管理 / [日結] 停用時的提示",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
    itemSpacing: 12,
  });
  f.fills = [await paint("bg/default")];
  add(
    f,
    await txt(
      "[日結] 停用:這家店還有收銀點的班沒有送出交班結帳(交班結帳還在審核中不擋)。滑過按鈕顯示:",
      "Body/2",
      "text/secondary",
    ),
  );
  const r = add(
    f,
    al("HORIZONTAL", {
      name: "buttons",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
  );
  add(r, await btn("存銀行", "Outlined"));
  add(r, await btn("日結", "Contained", "Medium", "Disabled"));
  const tip = await inst("Draft/Tooltip", { Placement: "Bottom" });
  await loadFontsIn(tip);
  tip.findAll((n) => n.type === "TEXT")[0].characters =
    "還沒結帳的班:店外攤位(陳大文,13:00 開班)";
  add(f, tip);
  page.appendChild(f);
  f.x = 1560;
  f.y = 0;
  out.dayCloseDisabled = f.id;
}
// 交班結帳、日結、存銀行與 58mm 單據見 store-wizards.js。
return out;
