// Draft/AdminSideNav+(scratch-lot 專用的過渡草稿):現有 Draft/AdminSideNav 的系統管理群組只有 4 個備用槽,
// 本輪要放「通知設定」「印表機管理」兩個新頁,第 5 個槽先做在這個草稿上(底座規格 5、6)。
// 前置:貼上 _resolve.js(MODE = 'scratch');在草稿頁執行。
// 在 wowgo-base 重建時**不要**跑這支:直接在 Draft/AdminSideNav(2001:1214)的 group-children 複製 spare-4 成 spare-5(README 步驟 4),
// 參考畫面腳本的 sysNav() 找不到 Draft/AdminSideNav+ 時就直接用現有側欄的 spare-5。
if (MODE === "base")
  throw new Error("wowgo-base 直接改 Draft/AdminSideNav,不建這個草稿");
const src = await comp("Draft/AdminSideNav");
const inst0 = (
  src.type === "COMPONENT_SET" ? src.defaultVariant : src
).createInstance();
figma.currentPage.appendChild(inst0);
const c = figma.createComponentFromNode(inst0.detachInstance());
c.name = "Draft/AdminSideNav+";
c.description =
  "【底座・本輪草稿,搬回底座時併入 Draft/AdminSideNav】現有側欄多一個系統管理群組的備用槽 spare-5(放「印表機管理」);其餘與 Draft/AdminSideNav 相同。";
const gc = c.findOne((n) => n.name === "group-children");
const s4 = gc.findChild((n) => n.name === "spare-4");
const s5 = s4.clone();
gc.insertChild(gc.children.indexOf(s4) + 1, s5);
s5.name = "spare-5";
s5.visible = false;
const k = c.addComponentProperty("ShowLogo", "BOOLEAN", false);
const logo = c.findChild((n) => n.name === "logoImg");
if (logo) logo.componentPropertyReferences = { visible: k };
// Library 側欄的收合鈕沒綁變數(框 #939ea9、« #374151):框改綁 divider(同側欄右框,透明度 0.24),« 改綁 text/secondary
const tg = c.findOne((n) => n.name === "collapse-toggle");
if (tg)
  tg.strokes = [
    figma.variables.setBoundVariableForPaint(
      { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.24 },
      "color",
      await tok("divider"),
    ),
  ];
const chev = tg && tg.findOne((n) => n.type === "TEXT");
if (chev) chev.fills = [await paint("text/secondary")];
return { id: c.id };
