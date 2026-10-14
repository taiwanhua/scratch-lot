// 底座參考畫面草稿:通知設定、印表機管理、流程設計器審核者來源面板。
// 前置:貼上 _resolve.js;目標頁已有本輪草稿元件(Draft/NotificationBell、Draft/AudiencePicker、Draft/ActionIcon+)。
// 每個畫面各自成段,可以只執行其中一段(把不需要的段落註解掉)。
figma.skipInvisibleInstanceChildren = false; // FIGMA-08:要走訪實例內隱藏的子節點

function spacer(p) {
  const s = add(p, al("HORIZONTAL", { name: "spacer" }), "FILL");
  s.resize(s.width, 1);
  return s;
}
// 殼:Draft/AdminSideNav + main(AdminAppBar、AdminRouteTabs、content)。
// 通知鈴暫以絕對定位疊在 AppBar 右側(底座 AdminAppBar 尚無鈴的槽,搬回底座時要在 AppBar 加槽)。
async function shell(name, title, tabLabel) {
  const s = figma.createFrame();
  s.name = name;
  s.layoutMode = "HORIZONTAL";
  s.resize(1440, 900);
  s.primaryAxisSizingMode = "FIXED";
  s.counterAxisSizingMode = "FIXED";
  s.fills = [await paint("bg/default")];
  s.clipsContent = true;
  add(s, await inst("Draft/AdminSideNav"), null, "FILL");
  const main = al("VERTICAL", { name: "main" });
  add(s, main, "FILL", "FILL");
  add(main, await inst("Draft/AdminAppBar", {}, { Title: title }), "FILL");
  const rt = await inst("Draft/AdminRouteTabs");
  for (const t of rt.findAll(
    (x) => x.type === "INSTANCE" && /^tab-/.test(x.name),
  )) {
    if (t.name === "tab-1") await setProps(t, { Label: tabLabel });
    else t.visible = false;
  }
  add(main, rt, "FILL");
  const content = al("VERTICAL", {
    name: "content",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 24,
    paddingBottom: 24,
    itemSpacing: 16,
  });
  add(main, content, "FILL", "FILL");
  const bell = draft("Draft/NotificationBell")
    .children.find((v) => v.name === "Unread=True")
    .createInstance();
  bell.name = "notification-bell(待 AppBar 加槽)";
  main.appendChild(bell);
  bell.layoutPositioning = "ABSOLUTE";
  bell.x = 1200 - 32 - 40 - 360;
  bell.y = 12;
  return { s, content };
}
async function card(name = "card") {
  const c = al("VERTICAL", {
    name,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
    itemSpacing: 16,
  });
  c.fills = [await paint("bg/paper")];
  await radius(c, "radius/md");
  return c;
}
async function cellT(label, strong) {
  return inst(
    "Draft/TableCell",
    { Emphasis: strong ? "Strong" : "Default" },
    { Label: label },
  );
}
// cells:字串 = TableCell(表頭則為 Subtitle/2 字);陣列 = 多個節點並排;節點 = 直接放
async function tableRow(cells, widths, header) {
  const r = al("HORIZONTAL", {
    name: header ? "thead" : "tr",
    paddingTop: header ? 10 : 14,
    paddingBottom: header ? 10 : 14,
    paddingLeft: 16,
    paddingRight: 16,
    itemSpacing: 16,
    counterAxisAlignItems: "CENTER",
  });
  if (header) r.fills = [await paint("bg/default")];
  r.strokes = [await paint("divider")];
  r.strokeTopWeight = r.strokeLeftWeight = r.strokeRightWeight = 0;
  r.strokeBottomWeight = 1;
  for (let i = 0; i < cells.length; i++) {
    const box = al("HORIZONTAL", {
      name: "td",
      itemSpacing: 6,
      counterAxisAlignItems: "CENTER",
    });
    box.resize(widths[i], 20);
    box.primaryAxisSizingMode = "FIXED";
    const v = cells[i];
    if (Array.isArray(v)) for (const x of v) add(box, x);
    else if (typeof v === "string")
      add(
        box,
        header ? await txt(v, "Subtitle/2", "text/secondary") : await cellT(v),
      );
    else add(box, v);
    for (const ch of box.children)
      if (
        ch.type === "INSTANCE" &&
        ch.variantProperties &&
        "Emphasis" in ch.variantProperties
      )
        ch.layoutSizingHorizontal = "FILL";
    add(r, box);
  }
  return r;
}
async function overlay(name, width) {
  const ov = figma.createFrame();
  ov.name = name;
  ov.resize(1440, 900);
  ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }]; // 遮罩色:FIGMA-06 Overlay 慣例(半透黑)
  ov.clipsContent = false;
  const dlg = al("VERTICAL", {
    name: "dialog",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
    itemSpacing: 16,
  });
  dlg.fills = [await paint("bg/paper")];
  dlg.effectStyleId = (await style("Shadow/Dialog")).id;
  await radius(dlg, "radius/md");
  dlg.clipsContent = false;
  ov.appendChild(dlg);
  dlg.counterAxisSizingMode = "FIXED";
  dlg.resize(width, 100);
  dlg.primaryAxisSizingMode = "AUTO";
  dlg.x = (1440 - width) / 2;
  dlg.y = 80;
  return { ov, dlg };
}
async function actions(dlg, labels) {
  const ft = al("HORIZONTAL", { name: "actions", itemSpacing: 8 });
  spacer(ft);
  for (const [label, variant] of labels)
    add(
      ft,
      await inst(
        "Button",
        {
          Variant: variant,
          Size: "Medium",
          State: "Default",
          Color: "Primary",
        },
        { Label: label },
      ),
    );
  add(dlg, ft, "FILL");
}

// ==== 1. 通知設定 system.notification-settings ====
{
  const { s, content } = await shell(
    "Base Draft / 通知設定(system.notification-settings)",
    "通知設定",
    "通知設定",
  );
  const c = await card();
  add(content, c, "FILL");
  add(c, await txt("負責人提醒", "Subtitle/1"));
  add(
    c,
    await txt(
      "這些提醒的收件人可以依角色、組織與權限調整。待你審核、申請結果這類通知會直接送給當事人,不在這裡設定。",
      "Body/2",
      "text/secondary",
    ),
  );
  const W = [180, 170, 230, 330, 80];
  const tb = al("VERTICAL", { name: "table" });
  add(c, tb, "FILL");
  add(
    tb,
    await tableRow(["通知類型", "預設管道", "組織範圍", "收件人", ""], W, true),
    "FILL",
  );
  // 示範資料用底座情境(中性),不出現任何專案用語
  const data = [
    ["示範表單到期提醒", ["站內", "Email"], "單據所屬組織", "角色 主管"],
    [
      "印表機離線",
      ["站內"],
      "印表機所在組織含上層",
      "角色 主管 且 持有 system.printers.edit",
    ],
    [
      "Email 寄送失敗",
      ["站內"],
      "最上層組織",
      "持有 system.notification-settings.edit",
    ],
  ];
  for (const [t, ch, o, a] of data) {
    const tags = [];
    for (const x of ch)
      tags.push(await inst("Draft/Tag", { Tone: "Grey" }, { Label: x }));
    add(
      tb,
      await tableRow(
        [
          await cellT(t, true),
          tags,
          o,
          a,
          await inst("Link", { State: "Default" }, { Label: "編輯" }),
        ],
        W,
        false,
      ),
      "FILL",
    );
  }
  add(
    c,
    await txt(
      "示範資料;實際的提醒類型由底座與各專案各自登記。",
      "Caption",
      "text/secondary",
    ),
  );

  const { ov, dlg } = await overlay("Overlay / 編輯收件人", 820);
  add(dlg, await txt("編輯收件人:印表機離線", "Heading/H6"));
  add(
    dlg,
    await inst(
      "Draft/Alert",
      { Severity: "Info" },
      {
        Message:
          "組織範圍:印表機所在組織含上層(由通知類型決定,不能修改)。收件人 = 組織範圍內、而且符合下列條件的人。",
      },
    ),
    "FILL",
  );
  const ap = draft("Draft/AudiencePicker")
    .children.find((v) => v.name === "AllowEveryone=False, Value=Conditions")
    .createInstance();
  add(dlg, ap, "FILL");
  await actions(dlg, [
    ["取消", "Text"],
    ["儲存", "Contained"],
  ]);
}

// ==== 2. 印表機管理 system.printers(代理程式分頁)====
{
  const icons = draft("Draft/ActionIcon+");
  const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);
  const iconBtn = async (k) => {
    const b = await inst("Draft/IconButton", {
      Variant: "Plain",
      Size: "Small",
    });
    const pk = Object.keys(b.componentProperties).find((x) =>
      x.startsWith("Icon"),
    );
    b.setProperties({ [pk]: glyph(k).id });
    return b;
  };
  const lnk = (l) => inst("Link", { State: "Default" }, { Label: l });
  const { s, content } = await shell(
    "Base Draft / 印表機管理(system.printers)",
    "印表機管理",
    "印表機管理",
  );
  // PageTabs = 既有 Draft/Tabs 的組法(Draft/Tab × n + 底線);此處三個分頁
  const tabs = al("HORIZONTAL", { name: "page-tabs(PageTabs = Draft/Tabs)" });
  tabs.strokes = [await paint("divider")];
  tabs.strokeTopWeight = tabs.strokeLeftWeight = tabs.strokeRightWeight = 0;
  tabs.strokeBottomWeight = 1;
  for (const [l, a] of [
    ["印表機", false],
    ["代理程式", true],
    ["列印紀錄", false],
  ])
    add(
      tabs,
      await inst(
        "Draft/Tab",
        { State: a ? "Active" : "Default" },
        { Label: l },
      ),
    );
  add(content, tabs, "FILL");
  const dl = await card("download");
  const dh = al("HORIZONTAL", {
    name: "head",
    itemSpacing: 8,
    counterAxisAlignItems: "CENTER",
  });
  add(dh, await txt("列印代理程式", "Subtitle/1"));
  add(
    dh,
    await inst("Draft/Tag", { Tone: "Primary" }, { Label: "最新版本 1.0.0" }),
  );
  spacer(dh);
  add(
    dh,
    await inst(
      "Button",
      {
        Variant: "Contained",
        Size: "Medium",
        State: "Default",
        Color: "Primary",
      },
      { Label: "新增代理程式" },
    ),
  );
  add(dl, dh, "FILL");
  add(
    dl,
    await txt(
      "裝在店內每天開著的電腦上(可以和收銀共用同一台);一家店只需要一個。電腦和收據機要在同一個區域網路,並關閉睡眠。",
      "Body/2",
      "text/secondary",
    ),
  );
  const btns = al("HORIZONTAL", { name: "downloads", itemSpacing: 8 });
  for (const [l, v] of [
    ["下載 Windows(建議)", "Contained"],
    ["下載 Linux x64", "Outlined"],
    ["下載 Linux arm64", "Outlined"],
    ["下載 macOS", "Outlined"],
  ])
    add(
      btns,
      await inst(
        "Button",
        { Variant: v, Size: "Small", State: "Default", Color: "Primary" },
        { Label: l },
      ),
    );
  add(dl, btns);
  add(content, dl, "FILL");
  const tc = await card("agents");
  const W = [190, 130, 110, 130, 160, 220]; // 總寬要放得進卡片(audit overflowNodes)
  const tb = al("VERTICAL", { name: "table" });
  add(tc, tb, "FILL");
  add(
    tb,
    await tableRow(["名稱", "分店", "狀態", "最後連線", "版本", ""], W, true),
    "FILL",
  );
  add(
    tb,
    await tableRow(
      [
        await cellT("示範分店 A 櫃台電腦", true),
        "示範分店 A",
        await inst("Draft/Tag", { Tone: "Success" }, { Label: "已連線" }),
        "1 分鐘前",
        "1.0.0",
        [await lnk("重新配對"), await lnk("停用")],
      ],
      W,
      false,
    ),
    "FILL",
  );
  add(
    tb,
    await tableRow(
      [
        await cellT("信義店小主機", true),
        "信義店",
        await inst("Draft/Tag", { Tone: "Grey" }, { Label: "離線" }),
        "3 天前",
        [
          await cellT("0.9.2"),
          await inst("Draft/Tag", { Tone: "Warning" }, { Label: "請更新" }),
        ],
        [await lnk("重新配對"), await lnk("停用")],
      ],
      W,
      false,
    ),
    "FILL",
  );
  add(content, tc, "FILL");

  const { ov, dlg } = await overlay("Overlay / 新增代理程式(配對碼)", 560);
  add(dlg, await txt("新增代理程式", "Heading/H6"));
  const f1 = await inst("Draft/SelectField", { State: "Default" });
  for (const t of f1.findAll((x) => x.type === "TEXT")) {
    await figma.loadFontAsync(t.fontName);
    if (t.name === "label") t.characters = "分店";
    if (t.name === "value") t.characters = "示範分店 A";
    if (t.name === "chevron") t.characters = "▾";
  }
  add(dlg, f1, "FILL");
  add(
    dlg,
    await inst(
      "TextField",
      { Size: "Small", State: "Default" },
      { Label: "名稱", Value: "示範分店 A 櫃台電腦" },
    ),
    "FILL",
  );
  const box = al("VERTICAL", {
    name: "pairing",
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 12,
    itemSpacing: 8,
  });
  box.fills = [await paint("bg/default")];
  await radius(box, "radius/sm");
  for (const [label, value, st] of [
    ["伺服器網址", "https://api.scratch-lot.example", "Body/2"],
    ["配對碼", "8K3M-Q7PZ", "Heading/H6"],
  ]) {
    const r = al("HORIZONTAL", {
      name: label,
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    });
    add(r, await txt(label, "Caption", "text/secondary"));
    add(r, await txt(value, st));
    spacer(r);
    add(r, await iconBtn("copy"));
    add(box, r, "FILL");
  }
  add(
    box,
    await txt(
      "10 分鐘內有效。在店內電腦執行安裝程式,貼上伺服器網址與配對碼即可完成。",
      "Caption",
      "text/secondary",
    ),
  );
  add(dlg, box, "FILL");
  await actions(dlg, [["完成", "Contained"]]);
}

// ==== 3. 流程設計器 審核者來源面板(B3):客製流程 / 共用流程 ====
async function approverPanel(shared) {
  const p = al("VERTICAL", {
    name:
      "Base Draft / 流程設計器 審核者來源(" +
      (shared ? "共用流程" : "客製流程") +
      ")",
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 16,
    paddingBottom: 20,
    itemSpacing: 14,
  });
  p.fills = [await paint("bg/paper")];
  p.effectStyleId = (await style("Shadow/Card")).id;
  await radius(p, "radius/md");
  p.clipsContent = false;
  p.counterAxisSizingMode = "FIXED";
  p.resize(820, 100);
  p.primaryAxisSizingMode = "AUTO";
  add(p, await txt("關卡屬性" + (shared ? "(共用流程)" : ""), "Subtitle/1"));
  add(
    p,
    await inst(
      "TextField",
      { Size: "Small", State: "Default" },
      { Label: "名稱", Value: "店長審核" },
    ),
    "FILL",
  );
  add(p, await txt("審核者來源", "Caption/SemiBold", "text/secondary"));
  const rg = al("HORIZONTAL", {
    name: "source",
    itemSpacing: 24,
    counterAxisAlignItems: "CENTER",
  });
  for (const [l, on] of [
    ["人員條件", true],
    ["表單欄位", false],
    ["主管", false],
  ]) {
    const it = al("HORIZONTAL", {
      name: "radio-" + l,
      itemSpacing: 6,
      counterAxisAlignItems: "CENTER",
    });
    add(it, await inst("Draft/Radio", { State: on ? "Selected" : "Default" }));
    add(it, await txt(l, "Body/2"));
    add(rg, it);
  }
  add(p, rg);
  if (shared)
    add(
      p,
      await inst(
        "Draft/Alert",
        { Severity: "Warning" },
        {
          Message:
            "共用流程:各租戶的使用者與角色不同,條件只能用「權限」與組織來源(單據所屬組織、表單的組織欄位、最上層組織)。用到使用者或角色會擋下(AUDIENCE_IN_SHARED)。",
        },
      ),
      "FILL",
    );
  const ap = draft("Draft/AudiencePicker")
    .children.find((v) => v.name === "AllowEveryone=False, Value=Conditions")
    .createInstance();
  add(p, ap, "FILL");
  if (shared) {
    // 共用流程示範只用權限與動態組織來源
    const rows = ap.findAll((n) => n.name === "condition-row");
    const setSel = async (row, idx, val) => {
      const s = row.children.filter(
        (c) =>
          c.type === "INSTANCE" &&
          Object.keys(c.componentProperties).some((k) => k.startsWith("Value")),
      )[idx];
      for (const t of s.findAll((t) => t.type === "TEXT"))
        await figma.loadFontAsync(t.fontName);
      s.setProperties({
        [Object.keys(s.componentProperties).find((k) => k.startsWith("Value"))]:
          val,
      });
    };
    const setChip = async (row, val) => {
      const t = row
        .findOne((n) => n.name === "value-chips")
        .findOne((n) => n.type === "TEXT");
      await figma.loadFontAsync(t.fontName);
      t.characters = val;
    };
    await setSel(rows[0], 0, "權限");
    await setSel(rows[0], 1, "持有");
    await setChip(rows[0], "purchasing.purchase.settle");
    await setSel(rows[1], 2, "【單據所屬組織】");
    await setSel(rows[1], 3, "本身");
    await setSel(rows[2], 0, "所屬組織");
    await setSel(rows[2], 1, "屬於");
    await setChip(rows[2], "【最上層組織】");
  }
  const opt = al("VERTICAL", { name: "options", itemSpacing: 8 });
  for (const l of [
    "申請人是審核者時自動通過(B5)",
    "同一人前面關卡已核准時自動通過(B5)",
  ]) {
    const r = al("HORIZONTAL", {
      name: "switch-row",
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    });
    add(r, await inst("Draft/Switch", { State: "Off", Enabled: "True" }));
    add(r, await txt(l, "Body/2"));
    add(opt, r);
  }
  add(p, opt);
  return p;
}
await approverPanel(false);
await approverPanel(true);
