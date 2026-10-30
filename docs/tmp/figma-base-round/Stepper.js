// Draft/StepperStep + Draft/Stepper(底座規格 10.8,第 27 項)。前置:貼上 _resolve.js;底座 Draft/ActionIcon 已併入本輪圖示(README「搬回底座的方法」第 2 步)。
// 由專案草稿 Draft/WizardStep 升格而來;專案畫面改用本元件。
// StepperStep 屬性:State=Done / Current / Todo / Error;Index、Label(TEXT)。
// Stepper 屬性:Width=Wide / Narrow;Narrow 只顯示「第 N / M 步 · 名稱」+ 進度條。
const icons = await comp("Draft/ActionIcon");
const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);

async function step(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "HORIZONTAL";
  c.itemSpacing = 8;
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "AUTO";
  c.fills = [];
  const dot = add(
    c,
    al("HORIZONTAL", {
      name: "index",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
    }),
  );
  dot.resize(24, 24);
  dot.primaryAxisSizingMode = "FIXED";
  dot.counterAxisSizingMode = "FIXED";
  dot.cornerRadius = 12;
  const n = add(
    dot,
    await txt("1", "Caption/SemiBold", "primary/contrast", "n"),
  );
  const l = add(
    c,
    await txt("基本資料", "Subtitle/2", "text/primary", "label"),
  );
  if (state === "Done") {
    dot.fills = [await paint("primary/main")];
    n.visible = false;
    const ic = glyph("check").createInstance();
    ic.name = "done-icon";
    ic.resize(16, 16);
    add(dot, ic);
    for (const v of ic.findAll((x) => "fills" in x && x.type === "VECTOR"))
      v.fills = [await paint("primary/contrast")];
  } else if (state === "Current") {
    dot.fills = [await paint("primary/main")];
  } else if (state === "Error") {
    dot.fills = [await paint("error/main")];
    n.characters = "!";
    n.fills = [await paint("common/white")];
    l.fills = [await paint("error/main")];
  } else {
    dot.fills = [await paint("action/disabledBackground")];
    n.fills = [await paint("text/secondary")];
    l.fills = [await paint("text/secondary")];
  }
  return c;
}
const ss = figma.combineAsVariants(
  [
    await step("Done"),
    await step("Current"),
    await step("Todo"),
    await step("Error"),
  ],
  figma.currentPage,
);
ss.name = "Draft/StepperStep";
ss.layoutMode = "HORIZONTAL";
ss.itemSpacing = 24;
ss.paddingLeft = ss.paddingRight = ss.paddingTop = ss.paddingBottom = 16;
ss.primaryAxisSizingMode = "AUTO";
ss.counterAxisSizingMode = "AUTO";
const pi = ss.addComponentProperty("Index", "TEXT", "1");
const pl = ss.addComponentProperty("Label", "TEXT", "基本資料");
for (const v of ss.children) {
  const n = v.findOne((x) => x.name === "n");
  if (v.name !== "State=Error")
    n.componentPropertyReferences = { characters: pi };
  v.findOne((x) => x.name === "label").componentPropertyReferences = {
    characters: pl,
  };
}
ss.description =
  DESC_PREFIX +
  "Stepper 的一步(@repo/ui,底座規格 10.8)。Done = 已完成(主色底 + 勾,可點回)、Current = 進行中(主色底 + 編號)、Todo = 未開始(停用底)、Error = 有錯(error 底 + !,名稱 error 色)。屬性 Index、Label。";

const LABELS = ["基本資料", "明細", "附件", "審核人", "確認"];
async function stepper(width) {
  const c = figma.createComponent();
  c.name = "Width=" + width;
  c.fills = [];
  if (width === "Wide") {
    c.layoutMode = "HORIZONTAL";
    c.itemSpacing = 12;
    c.counterAxisAlignItems = "CENTER";
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "AUTO";
    for (let i = 0; i < LABELS.length; i++) {
      if (i) {
        const ln = figma.createRectangle();
        ln.name = "connector";
        ln.resize(32, 2);
        ln.fills = [await paint(i <= 1 ? "primary/main" : "divider")];
        add(c, ln);
      }
      const st = ["Done", "Current", "Todo", "Todo", "Todo"][i];
      const s = ss.children.find((v) => v.name === "State=" + st);
      add(
        c,
        await setProps(s.createInstance(), {
          Index: String(i + 1),
          Label: LABELS[i],
        }),
      );
    }
  } else {
    c.layoutMode = "VERTICAL";
    c.itemSpacing = 8;
    c.counterAxisSizingMode = "FIXED";
    c.resize(343, 10);
    c.primaryAxisSizingMode = "AUTO";
    add(
      c,
      await txt("第 2 / 5 步 · 明細", "Subtitle/2", "text/primary", "summary"),
    );
    const bar = add(
      c,
      al("HORIZONTAL", { name: "progress", itemSpacing: 4 }),
      "FILL",
    );
    for (let i = 0; i < 5; i++) {
      const seg = figma.createRectangle();
      seg.name = "seg";
      seg.resize(10, 4);
      seg.cornerRadius = 2;
      seg.fills = [
        await paint(i <= 1 ? "primary/main" : "action/disabledBackground"),
      ];
      add(bar, seg, "FILL");
    }
  }
  return c;
}
const st = figma.combineAsVariants(
  [await stepper("Wide"), await stepper("Narrow")],
  figma.currentPage,
);
st.name = "Draft/Stepper";
st.layoutMode = "VERTICAL";
st.itemSpacing = 24;
st.paddingLeft = st.paddingRight = st.paddingTop = st.paddingBottom = 16;
st.primaryAxisSizingMode = "AUTO";
st.counterAxisSizingMode = "AUTO";
st.description =
  DESC_PREFIX +
  "Stepper 精靈步驟(@repo/ui,底座規格 10.8):Width=Wide 依序排 Draft/StepperStep 與連接線(已完成段主色);Width=Narrow(窄螢幕)只顯示「第 N / M 步 · 名稱」+ 分段進度條。步驟內容與 [上一步] [下一步] 的條件由使用頁面決定。示範為日結 5 步。";
return { stepSet: ss.id, stepper: st.id };
