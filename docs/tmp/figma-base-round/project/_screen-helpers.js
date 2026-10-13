// 專案畫面共用工具。前置:project/_header.js。呼叫前先設定 PROJ_PAGE = 「Project Draft / 刮刮樂元件」頁(64:14)。
// 殼:Draft/ScratchLotSideNav(專案側欄)+ main(AdminAppBar、AdminRouteTabs、content);通知鈴同底座參考畫面,暫以絕對定位疊在 AppBar 上。
async function selectNav(nav, label) {
  const it = nav.findOne((n) => n.name === "nav:" + label);
  if (!it) return;
  it.fills = [await paint("primary/lighter")];
  const t = it.findOne((n) => n.type === "TEXT" && n.characters === label);
  if (t) {
    await loadFontsIn(it);
    t.fills = [await paint("primary/dark")];
  }
}
async function pshell(name, title, navLabel, tabLabel, h = 900) {
  const s = figma.createFrame();
  s.name = name;
  s.layoutMode = "HORIZONTAL";
  s.resize(1440, h);
  s.primaryAxisSizingMode = "FIXED";
  s.counterAxisSizingMode = "FIXED";
  s.fills = [await paint("bg/default")];
  s.clipsContent = true;
  const nav = projDraft("Draft/ScratchLotSideNav").createInstance();
  add(s, nav, null, "FILL");
  await selectNav(nav, navLabel);
  const main = al("VERTICAL", { name: "main" });
  add(s, main, "FILL", "FILL");
  const bar = await inst("Draft/AdminAppBar", {}, { Title: title });
  await setText(bar, "wowgo-base", "中山店");
  add(main, bar, "FILL");
  const rt = await inst("Draft/AdminRouteTabs");
  for (const t of rt.findAll(
    (x) => x.type === "INSTANCE" && /^tab-/.test(x.name),
  )) {
    if (t.name === "tab-1") await setProps(t, { Label: tabLabel || title });
    else t.visible = false;
  }
  add(main, rt, "FILL");
  const content = al("VERTICAL", {
    name: "content",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 24,
    itemSpacing: 16,
  });
  add(main, content, "FILL", "FILL");
  const bell = (await baseDraft("Draft/NotificationBell")).children
    .find((v) => v.name === "Unread=True")
    .createInstance();
  bell.name = "notification-bell(待 AppBar 加槽)";
  main.appendChild(bell);
  bell.layoutPositioning = "ABSOLUTE";
  bell.x = 1200 - 32 - 40 - 360;
  bell.y = 12;
  return { s, content, main };
}
async function card(name = "card", gap = 12) {
  const c = al("VERTICAL", {
    name,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 16,
    paddingBottom: 16,
    itemSpacing: gap,
  });
  c.fills = [await paint("bg/paper")];
  await radius(c, "radius/md");
  return c;
}
async function tabsRow(labels, active) {
  const r = al("HORIZONTAL", { name: "PageTabs(Draft/Tab)", itemSpacing: 0 });
  r.strokes = [await paint("divider")];
  r.strokeTopWeight = r.strokeLeftWeight = r.strokeRightWeight = 0;
  r.strokeBottomWeight = 1;
  for (const l of labels)
    add(
      r,
      await inst(
        "Draft/Tab",
        { State: l === active ? "Active" : "Default" },
        { Label: l, Badge: false },
      ),
    );
  return r;
}
const btn = (
  label,
  variant = "Contained",
  size = "Medium",
  state = "Default",
  color = "Primary",
) =>
  inst(
    "Button",
    { Variant: variant, Size: size, State: state, Color: color },
    { Label: label },
  );
const tag = (label, tone = "Grey") =>
  inst("Draft/Tag", { Tone: tone }, { Label: label });
async function field(label, value, opts = {}) {
  const f = await inst(
    "TextField",
    { Size: opts.size || "Small", State: opts.state || "Default" },
    { Label: label, Value: value, Helper: opts.helper || "" },
  );
  if (opts.width) f.resize(opts.width, f.height);
  return f;
}
// SelectField 的文字節點依名稱:label / value / chevron(▾);只改 label 與 value
async function select(label, value, width, state = "Default") {
  const f = await inst("Draft/SelectField", { State: state });
  await loadFontsIn(f);
  const L = f.findOne((n) => n.type === "TEXT" && n.name === "label");
  const V = f.findOne((n) => n.type === "TEXT" && n.name === "value");
  if (L) L.characters = label;
  if (V) V.characters = value;
  if (width) f.resize(width, f.height);
  return f;
}
async function divider(p) {
  const d = figma.createRectangle();
  d.name = "divider";
  d.resize(100, 1);
  d.fills = [await paint("divider")];
  add(p, d, "FILL");
  return d;
}
async function wrapCaption(p, s) {
  const t = add(p, await txt(s, "Caption", "text/secondary"));
  t.layoutSizingHorizontal = "FILL";
  t.textAutoResize = "HEIGHT";
  return t;
}
async function titleRow(content, title, sub) {
  const r = add(
    content,
    al("HORIZONTAL", {
      name: "title",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(r, await txt(title, "Heading/H6"));
  if (sub) add(r, await txt(sub, "Body/2", "text/secondary"));
  spacer(r);
  add(r, await btn("取消", "Text"));
  return r;
}
// 畫面高度依內容撐開(最少 900)
function fitHeight(s) {
  const main = s.children.find((c) => c.name === "main");
  const content = main.children.find((c) => c.name === "content");
  const k = content.children;
  const last = k[k.length - 1];
  s.resize(
    1440,
    Math.max(900, Math.ceil((content.y + last.y + last.height + 24) / 10) * 10),
  );
}
// 鍵值列:左 label 右 value
async function kv(label, value, strong, valueColor) {
  const r = al("HORIZONTAL", {
    name: "kv",
    itemSpacing: 12,
    counterAxisAlignItems: "CENTER",
  });
  const l = add(r, await txt(label, "Body/2", "text/secondary"));
  spacer(r);
  add(
    r,
    typeof value === "string"
      ? await txt(
          value,
          strong ? "Subtitle/1" : "Body/1",
          valueColor || "text/primary",
        )
      : value,
  );
  return r;
}
async function cellT(label, strong) {
  return inst(
    "Draft/TableCell",
    { Emphasis: strong ? "Strong" : "Default" },
    { Label: label },
  );
}
async function tableRow(cells, widths, header) {
  const r = al("HORIZONTAL", {
    name: header ? "thead" : "tr",
    paddingTop: header ? 8 : 10,
    paddingBottom: header ? 8 : 10,
    paddingLeft: 12,
    paddingRight: 12,
    itemSpacing: 12,
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
    box.counterAxisSizingMode = "AUTO"; // 放 TextField 等較高的元件時不裁切
    const v = cells[i];
    const items = Array.isArray(v)
      ? v
      : [
          typeof v === "string"
            ? header
              ? await txt(v, "Subtitle/2", "text/secondary")
              : await cellT(v)
            : v,
        ];
    for (const x of items) {
      add(box, x);
      if (
        x.type === "INSTANCE" &&
        x.variantProperties &&
        "Emphasis" in x.variantProperties
      )
        x.layoutSizingHorizontal = "FILL";
    }
    add(r, box);
  }
  return r;
}
async function overlay(name, width, x, y) {
  const ov = figma.createFrame();
  ov.name = name;
  ov.resize(1440, 900);
  ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }]; // 遮罩:FIGMA-06 Overlay 慣例(半透黑)
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
  dlg.y = 100;
  ov.x = x;
  ov.y = y;
  return { ov, dlg };
}
async function actionsRow(items) {
  const ft = al("HORIZONTAL", {
    name: "actions",
    itemSpacing: 8,
    counterAxisAlignItems: "CENTER",
  });
  spacer(ft);
  for (const it of items) add(ft, it);
  return ft;
}
async function steps(labels, current) {
  const r = al("HORIZONTAL", {
    name: "steps",
    itemSpacing: 28,
    counterAxisAlignItems: "CENTER",
  });
  for (let i = 0; i < labels.length; i++)
    add(
      r,
      await pinst(
        "Draft/WizardStep",
        { State: i < current ? "Done" : i === current ? "Current" : "Todo" },
        { Index: String(i + 1), Label: labels[i] },
      ),
    );
  return r;
}
// 頁面上把畫面依序往右排
function placeRight(page, node, gap = 120) {
  const others = page.children.filter((n) => n !== node);
  const maxX = others.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  node.x = others.length ? maxX + gap : 0;
  node.y = 0;
}
