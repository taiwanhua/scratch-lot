// ==== 底座參考畫面:以現有畫面為底再套差異(第十九輪起)====
// 前置:`const PROJECT = false;` + _kit.js(MODE 同 _kit.js)+ 本檔,最後貼 Screens2-base.js 的 PART。
// 原則:每張 BS 畫面都先複製「現有底座參考畫面」(本檔 `Screen / Admin …` 各頁的同名框),只改本輪規格寫的差異;
// 側欄、頁首、分頁、卡片、表格、欄位、按鈕、間距都沿用現有的。依「名稱」找現有畫面,不寫死節點 id,在 wowgo-base 重建時也能用。
// 現有畫面在 scratch-lot 帶專案品牌色(scratch-lot Brand Library);複製進草稿頁後 rebase() 把非底座變數換回底座同名變數。
const REF_PAGE_PREFIX = "Screen / Admin ";
const BASE_COLOR_KEY = "9d2d67ea73654a9894d5c083e28754341526fba4";
const BASE_KEYS = [
  BASE_COLOR_KEY,
  "84c5f309f7b50688d1eca745ea4db116afb1ad5a",
  "1eea29cadf44f500544c6b840aea015c8a3b092b",
  "aa51fafef4bb2e4d3b578ccaa8bc8f1a930ed17e",
];
const _ref = { frames: new Map(), baseVars: null, colKey: {} };
async function refFrame(name) {
  if (_ref.frames.has(name)) return _ref.frames.get(name);
  for (const p of figma.root.children.filter((x) =>
    x.name.startsWith(REF_PAGE_PREFIX),
  )) {
    await p.loadAsync();
    const f = p.children.find((n) => n.name === name);
    if (f) {
      _ref.frames.set(name, f);
      return f;
    }
  }
  throw new Error("找不到現有底座畫面:" + name);
}
async function baseVar(name) {
  if (!_ref.baseVars) {
    _ref.baseVars = new Map();
    if (MODE === "base") {
      for (const c of await figma.variables.getLocalVariableCollectionsAsync())
        if (c.key === BASE_COLOR_KEY)
          for (const id of c.variableIds) {
            const v = await figma.variables.getVariableByIdAsync(id);
            _ref.baseVars.set(v.name, v);
          }
    } else {
      for (const v of await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
        BASE_COLOR_KEY,
      ))
        _ref.baseVars.set(v.name, v.key);
    }
  }
  let v = _ref.baseVars.get(name);
  if (typeof v === "string") {
    v = await figma.variables.importVariableByKeyAsync(v);
    _ref.baseVars.set(name, v);
  }
  return v || null;
}
async function colKeyOf(v) {
  if (!(v.variableCollectionId in _ref.colKey))
    _ref.colKey[v.variableCollectionId] = (
      await figma.variables.getVariableCollectionByIdAsync(
        v.variableCollectionId,
      )
    ).key;
  return _ref.colKey[v.variableCollectionId];
}
// 非底座的顏色綁定 → 底座同名變數(只處理本身不在實例裡的節點;實例內部跟著主元件,本來就是底座)
async function rebase(root) {
  let n = 0;
  const nodes = [root, ...(root.findAll ? root.findAll(() => true) : [])];
  for (const x of nodes) {
    for (const p of ["fills", "strokes"]) {
      if (!(p in x) || !Array.isArray(x[p])) continue;
      let changed = false;
      const out = [];
      for (const paint of x[p]) {
        const id = paint.boundVariables?.color?.id;
        if (!id) {
          out.push(paint);
          continue;
        }
        const v = await figma.variables.getVariableByIdAsync(id);
        if (!v || BASE_KEYS.includes(await colKeyOf(v))) {
          out.push(paint);
          continue;
        }
        const bv = await baseVar(v.name);
        if (!bv) {
          out.push(paint);
          continue;
        }
        out.push(figma.variables.setBoundVariableForPaint(paint, "color", bv));
        changed = true;
        n++;
      }
      if (changed) {
        try {
          x[p] = out;
        } catch (e) {
          /* 實例內部不可改的略過 */
        }
      }
    }
  }
  return n;
}
// 複製現有畫面成新的 BS 畫面(放在草稿頁、y 列)
async function refShell(refName, name) {
  const src = await refFrame(refName);
  const page = figma.currentPage;
  const s = src.clone();
  page.appendChild(s);
  s.name = name;
  s.x = 0;
  s.y = 0;
  await rebase(s);
  const main = s.findOne((n) => n.name === "main");
  const content = main && main.findOne((n) => n.name === "content");
  return { s, main, content, src: refName };
}
const q = (root, name) => root.findOne((n) => n.name === name);
const qa = (root, name) => root.findAll((n) => n.name === name);
async function txt(root, from, to) {
  const t = root.findOne((n) => n.type === "TEXT" && n.characters === from);
  if (!t) throw new Error(`找不到文字「${from}」(${root.name})`);
  await fonts({ findAll: () => [t] });
  t.characters = to;
  return t;
}
async function txtAll(root, from, to) {
  for (const t of root.findAll(
    (n) => n.type === "TEXT" && n.characters === from,
  )) {
    await fonts({ findAll: () => [t] });
    t.characters = to;
  }
}
// 頁首:只改 AppBar 標題與 RouteTabs 的分頁文字(側欄不動)
async function retitle(sh, from, to) {
  for (const host of sh.s.findAll(
    (n) => n.type === "INSTANCE" && /AdminAppBar|AdminRouteTabs/.test(n.name),
  ))
    await txtAll(host, from, to);
}
// 側欄目前頁的反白:現有畫面用覆寫的底色與字色表示;label = null 時全部不反白(例:個人設定不在側欄)
async function navActive(sh, label) {
  const nav = sh.s.findOne(
    (n) => n.type === "INSTANCE" && /^Draft\/AdminSideNav/.test(n.name),
  );
  if (!nav) return;
  const items = nav.findAll(
    (n) => n.type === "INSTANCE" && /NavItem|^spare-/.test(n.name),
  );
  const lab = (x) => x.findOne((n) => n.type === "TEXT" && n.name === "label");
  const act = items.find((x) => x.fills.length);
  const idle = items.find((x) => !x.fills.length && x.visible);
  if (!act || !idle) return;
  const on = { fills: act.fills, text: lab(act).fills };
  const off = lab(idle).fills;
  act.fills = [];
  await fonts({ findAll: () => [lab(act)] });
  lab(act).fills = off;
  if (!label) return;
  const t = items.find(
    (x) => x.visible && lab(x) && lab(x).characters === label,
  );
  if (!t) return;
  t.fills = on.fills;
  await fonts({ findAll: () => [lab(t)] });
  lab(t).fills = on.text;
}
// 清空一個容器的內容(保留容器本身的樣式與 auto layout)
function clear(node) {
  for (const c of [...node.children]) c.remove();
  return node;
}
// 遮罩 + 對話框:背景是入口畫面的副本(鎖定),上面蓋 50% 黑;對話框置中
async function refOverlay(bgShell, name, width) {
  const bgSrc = bgShell.s || bgShell;
  const s = figma.createFrame();
  s.name = name;
  s.resize(bgSrc.width, bgSrc.height);
  s.fills = [];
  s.clipsContent = true;
  figma.currentPage.appendChild(s);
  const bg = bgSrc.clone();
  s.appendChild(bg);
  bg.x = 0;
  bg.y = 0;
  bg.name = "背景:" + bgSrc.name;
  bg.locked = true;
  const scrim = figma.createRectangle();
  scrim.name = "scrim";
  scrim.resize(s.width, s.height);
  scrim.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
  s.appendChild(scrim);
  // 對話框沿用現有底座對話框的樣式(圓角、內距、陰影、標題、右下按鈕列)
  const src = await refFrame("Overlay / 退回修改「主管審核」");
  const dlg = src.children.find((n) => n.type === "FRAME").clone();
  s.appendChild(dlg);
  dlg.name = "dialog";
  await rebase(dlg);
  const title = dlg.findChild((n) => n.type === "TEXT");
  const acts = dlg.findChild((n) => n.name === "actions");
  for (const c of [...dlg.children]) if (c !== title && c !== acts) c.remove();
  clear(acts);
  dlg.resize(width, dlg.height);
  dlg.primaryAxisSizingMode = "AUTO";
  title.layoutSizingHorizontal = "FILL";
  // 內容放在標題與按鈕列之間
  const body = async (t, items, buttons) => {
    await fonts({ findAll: () => [title] });
    title.characters = t;
    for (const it of items) {
      dlg.insertChild(dlg.children.indexOf(acts), it);
      it.layoutSizingHorizontal = "FILL";
      if (it.type === "TEXT") it.textAutoResize = "HEIGHT";
    }
    acts.primaryAxisAlignItems = "MAX";
    for (const b of buttons) acts.appendChild(b);
  };
  const center = () => {
    if (dlg.height + 96 > s.height) {
      s.resize(s.width, dlg.height + 96);
      scrim.resize(s.width, s.height);
    }
    dlg.x = Math.round((s.width - dlg.width) / 2);
    dlg.y = Math.round(Math.max(48, (s.height - dlg.height) / 2));
  };
  return { s, dlg, body, center, src: "背景 " + bgSrc.name };
}
// 框外註解:第一行寫對應的現有畫面與本輪改動(r4-layout 把「<畫面名> · 註解」排在畫面右邊)
async function refNote(sh, changes) {
  const f = sh.s;
  await noteOut(f, "對應現有畫面:" + (sh.src || "—"));
  return noteOut(f, "本輪改動:" + changes);
}
// 側欄:「系統管理」群組現有 8 項之後依序加「通知設定」「印表機管理」(底座規格 5、6)。
// 現有側欄元件只剩 1 個備用槽(spare-4)→ 先放「通知設定」;「印表機管理」要等底座側欄元件加槽(README 步驟 4)。
async function sysNav(sh, extra = ["通知設定", "印表機管理"]) {
  const nav = sh.s.findOne(
    (n) => n.type === "INSTANCE" && /^Draft\/AdminSideNav/.test(n.name),
  );
  if (!nav) return [];
  const free = nav
    .findAll((n) => n.type === "INSTANCE" && /^spare-\d$/.test(n.name))
    .filter((n) => !n.visible);
  const missing = [];
  for (const l of extra) {
    const slot = free.shift();
    if (!slot) {
      missing.push(l);
      continue;
    }
    slot.visible = true;
    await setProps(slot, { Label: l });
  }
  return missing;
}
// 依現有表格的列樣式重建表格(表頭 = Draft/TableHeaderCell、儲存格 = Draft/TableCell;其他內容放在和現有一樣的包裝框)
// list:表格所在的容器(第 1 個子節點是表頭列、第 2 個是資料列、最後一個是頁尾)
async function refTable(list, cols, rows, o = {}) {
  const kids = [...list.children];
  const head = kids[0],
    row = kids[1],
    last = kids[kids.length - 1],
    // 頁尾:表格容器的最後一列是頁碼列(含 PaginationItem)才算;否則找同層的 TablePager
    foot = o.noFoot
      ? null
      : last.findOne &&
          last.findOne(
            (n) => n.type === "INSTANCE" && /Pagination/.test(n.name),
          )
        ? last
        : null,
    pager =
      foot ||
      (list.parent && list.parent.findChild((n) => /Pager/.test(n.name)));
  // 儲存格可能是元件本身,也可能是包了一層的框(申請中心的 DataTable)
  const inner = (c, re) =>
    c.type === "INSTANCE" && re.test(c.name)
      ? c
      : c.findOne
        ? c.findOne((n) => n.type === "INSTANCE" && re.test(n.name))
        : null;
  const hc = head.children[0];
  const dc =
    [...list.children]
      .flatMap((r) => r.children || [])
      .find((c) => inner(c, /TableCell$/)) || row.children[0];
  const wrap =
    row.children.find((c) => c.type === "FRAME" && !inner(c, /TableCell$/)) ||
    row.children.find((c) => c.type === "FRAME");
  const mkWrap = () => {
    if (wrap) {
      const w = wrap.clone();
      clear(w);
      return w;
    }
    return H(8, { name: "Frame" });
  };
  const out = [];
  const nh = head.clone();
  clear(nh);
  for (const [l, w] of cols) {
    const c = hc.clone();
    nh.appendChild(c);
    const i = inner(c, /TableHeaderCell$/);
    if (i) await setProps(i, { Label: l });
    c.resize(w, c.height);
  }
  out.push(nh);
  for (const r of rows) {
    const nr = row.clone();
    clear(nr);
    for (let i = 0; i < cols.length; i++) {
      const v = r[i],
        w = cols[i][1];
      if (typeof v === "string") {
        const c = dc.clone();
        nr.appendChild(c);
        const t = inner(c, /TableCell$/);
        if (t)
          await setProps(t, {
            Label: v,
            Emphasis: i === 0 && o.strong !== false ? "Strong" : "Default",
          });
        c.resize(w, c.height);
      } else {
        const c = mkWrap();
        nr.appendChild(c);
        c.itemSpacing = 8;
        c.counterAxisAlignItems = "CENTER";
        for (const x of [].concat(v || [])) c.appendChild(x);
        c.resize(w, Math.max(16, c.height));
        c.primaryAxisSizingMode = "FIXED";
        c.counterAxisSizingMode = "AUTO";
      }
    }
    out.push(nr);
  }
  for (const k of kids) if (k !== foot) k.remove();
  out.forEach((n, i) => list.insertChild(i, n));
  if (pager && o.footer) {
    const t = pager.findOne((n) => n.type === "TEXT");
    if (t) {
      await fonts({ findAll: () => [t] });
      t.characters = o.footer;
    }
  }
  return out;
}
// 把 SelectField 的標籤與值換掉(現有畫面的 SelectField 是覆寫文字)
async function setField(f, label, value) {
  await fonts(f);
  const L = f.findOne((n) => n.type === "TEXT" && n.name === "label");
  const Vv = f.findOne((n) => n.type === "TEXT" && n.name === "value");
  if (L && label != null) L.characters = label;
  if (Vv && value != null) Vv.characters = value;
  if (!L && !Vv) await setProps(f, { Label: label, Value: value });
  return f;
}
// 用標籤找欄位(SelectField / TextField)
const fieldBy = (root, label) =>
  root.findOne(
    (n) =>
      n.type === "INSTANCE" &&
      /SelectField|TextField/.test(n.name) &&
      (n.findOne(
        (t) =>
          t.type === "TEXT" && t.name === "label" && t.characters === label,
      ) ||
        Object.values(n.componentProperties || {}).some(
          (p) => p.value === label,
        )),
  );

// 本輪草稿元件(依名稱在草稿頁找)
async function dcomp(name) {
  const dp = figma.root.children.find((p) => p.name === DRAFT_PAGE);
  await dp.loadAsync();
  const c = dp.findChild((n) => n.name === name);
  if (!c) throw new Error("找不到草稿元件 " + name);
  return c;
}
const dvar = async (name, v) => {
  const c = await dcomp(name);
  return c.type === "COMPONENT_SET"
    ? (
        c.children.find((x) => x.name === v) || c.defaultVariant
      ).createInstance()
    : c.createInstance();
};
// 頁首換成新頁:AppBar 標題、RouteTabs 第 2 個分頁(第 1 個是總覽)改成新頁名,其餘分頁收起
async function pageTitle(sh, title) {
  const ab = sh.s.findOne(
    (n) => n.type === "INSTANCE" && /AdminAppBar/.test(n.name),
  );
  if (ab) await setProps(ab, { Title: title });
  const rt = sh.s.findOne(
    (n) => n.type === "INSTANCE" && /AdminRouteTabs/.test(n.name),
  );
  if (!rt) return;
  const tabs = rt.children.filter((n) => n.type === "INSTANCE" && n.visible);
  for (const [i, t] of tabs.entries()) {
    if (i === 1) {
      const tx = t.findOne((n) => n.type === "TEXT");
      await fonts({ findAll: () => [tx] });
      tx.characters = title;
    } else if (i > 1) t.visible = false;
  }
}
// 卡片裡的頁內分頁(現有 Draft/Tab):依 labels 重設,不夠就複製最後一個
async function cardTabs(tabsFrame, labels, active) {
  let tabs = tabsFrame.children.filter((n) => n.type === "INSTANCE");
  while (tabs.length < labels.length) {
    tabsFrame.appendChild(tabs[tabs.length - 1].clone());
    tabs = tabsFrame.children.filter((n) => n.type === "INSTANCE");
  }
  for (const [i, t] of tabs.entries()) {
    if (i >= labels.length) {
      t.remove();
      continue;
    }
    await setProps(t, {
      Label: labels[i],
      Badge: false,
      State: labels[i] === active ? "Active" : "Default",
    });
  }
}
