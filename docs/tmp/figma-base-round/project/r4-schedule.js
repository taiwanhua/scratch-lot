// 第十八輪:班表管理頁(70:14)整頁整理。用法:整段貼進 use_figma 執行(不需要 r4-lib.js),之後跑 r4-layout.js(PAGE_ID = "70:14")。
// 分三段執行:把 PART 換成 "fix" → "tm" → "new" → "post" 各跑一次(每次整段貼進 use_figma)。
// 依規格 16.8 的流程分列:我的班表(班表與打卡 / 我的畫休)、排班作業(排班表 / 自動排班 / 發布與異動 / 畫休總覽 / 行事曆 / 支援需求單)、
// 排班設定(排班人員 / 人力需求範本 / 規則)、出勤紀錄、補打卡申請。
// 1. 我的班表的分頁統一成「班表 | 我的畫休」(打卡在「班表」分頁的上方),拿掉多出來的「打卡」分頁。
// 2. 自動排班:SC-05a 改名 SC-20a(條件與方式);SC-20b = 排班表 + 結果面板(結果取代檢核面板的位置,附 [清除自動排入的人]);
//    刪除重複的 SC-05b(和 SC-15a 發布確認重複)與舊的 SC-20 整頁(條件與結果並排、沒有排班表)。
// 3. 編輯排班:SC-04 是草稿時的編輯(不顯示異動原因);SC-19 = 已發布後的編輯(異動原因必填),取代舊的 SC-19 小對話框。
// 4. 名稱統一(SC-25 打卡後的狀態、SC-15a 發布確認的平板 / 手機)。
// 執行一次即可;再跑會因節點已刪除而略過。
const PART = "fix";
if (PART === "fix") {
  const page = await figma.getNodeByIdAsync("70:14");
  await figma.setCurrentPageAsync(page);
  const done = [];
  async function fnt(t) {
    for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
      await figma.loadFontAsync(f);
  }
  async function setText(t, s) {
    await fnt(t);
    t.characters = s;
  }
  const get = (id) => figma.getNodeByIdAsync(id);

  // 1. 我的班表分頁
  for (const id of [
    "130:27827",
    "130:27513",
    "130:28692",
    "130:28757",
    "130:29094",
    "130:29145",
  ]) {
    const tabs = await get(id);
    if (!tabs) continue;
    const label = (c) => c.componentProperties["Label#69:0"].value;
    const punch = tabs.children.find((c) => label(c) === "打卡");
    if (!punch) continue;
    if (punch.componentProperties.State.value === "Active") {
      const sched = tabs.children.find((c) => label(c) === "班表");
      sched.setProperties({ State: "Active" });
    }
    punch.remove();
    done.push("tabs " + id);
  }

  // 4. 名稱
  const rename = {
    "223:4466": "SC-01 我的班表:班表與打卡(今天的班 + 月曆)",
    "130:28360": "SC-01 · 平板 我的班表:班表與打卡",
    "130:28804": "SC-01 · 手機 我的班表:班表與打卡",
    "130:27654": "SC-25 班表與打卡:打卡後、昨天未打下班卡、近 7 天不完整提醒",
    "130:28735": "SC-25 · 平板 班表與打卡:打卡後",
    "130:29137": "SC-25 · 手機 班表與打卡:打卡後",
    "130:29502": "SC-15a · 平板 發布確認",
    "209:27899": "SC-15a · 手機 發布確認",
    "130:27340": "SC-23 我的畫休:開放期間外、違反規則",
    "130:28670": "SC-23 · 平板 我的畫休:開放期間外、違反規則",
    "130:29086": "SC-23 · 手機 我的畫休:開放期間外、違反規則",
    "99:1600": "SC-04 Overlay / 編輯排班與職責(草稿)",
    "130:28103": "SC-31 支援需求單:列表 + 檢視 / 審核",
  };
  const capRename = {
    "171:12819": "SC-01 我的班表:班表與打卡(今天的班 + 月曆) · 註解",
    "171:12836":
      "SC-25 班表與打卡:打卡後、昨天未打下班卡、近 7 天不完整提醒 · 註解",
    "150:22603": "SC-04 Overlay / 編輯排班與職責(草稿) · 註解",
    "171:12837": "SC-31 支援需求單:列表 + 檢視 / 審核 · 註解",
  };
  for (const [id, nm] of Object.entries({ ...rename, ...capRename })) {
    const n = await get(id);
    if (n) n.name = nm;
  }

  // 2. 自動排班
  const sc05a = await get("222:21785");
  if (sc05a) {
    sc05a.name = "SC-20a Overlay / 自動排班:條件與方式";
    const cap = await get("171:12820");
    if (cap) {
      cap.name = sc05a.name + " · 註解";
      await setText(
        cap,
        "註解(不在畫面內)\n- 從排班表 [自動排班] 打開;只能在草稿執行。\n- 只填人力需求;畫休、店休、擋下的規則一定遵守。\n- 執行後回到排班表,結果顯示在檢核面板的位置(SC-20b)。",
      );
    }
  }
  const sc05b = await get("222:21833");
  if (sc05b) {
    sc05b.remove();
    done.push("removed SC-05b 222:21833");
  }
  const oldSc20 = await get("130:3345");
  const sc03 = await get("70:15");
  if (oldSc20 && sc03) {
    const b = sc03.clone();
    sc03.parent.appendChild(b);
    b.name = "SC-20b 自動排班結果:排班表 + 結果面板";
    const panels = b.findOne((n) => n.name === "panels" && n.type === "FRAME");
    const chk = panels.children.find((n) => n.name === "檢核");
    const res = (await get("130:3558")).clone();
    panels.insertChild(panels.children.indexOf(chk), res);
    res.layoutSizingHorizontal = "FILL";
    chk.remove();
    // 結果面板標題列加 [清除自動排入的人]
    const head = res.children[0];
    const row = figma.createAutoLayout("HORIZONTAL", {
      name: "result-head",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    });
    row.fills = [];
    res.insertChild(0, row);
    row.layoutSizingHorizontal = "FILL";
    row.appendChild(head);
    head.layoutGrow = 1;
    const clr = (await get("130:3554")).clone();
    row.appendChild(clr);
    const t = head.type === "TEXT" ? head : null;
    if (t) await setText(t, "自動排班結果 · 11/01 21:40 執行(只填空位)");
    oldSc20.remove();
    const cap = await get("171:12831");
    if (cap) {
      cap.name = b.name + " · 註解";
      await setText(
        cap,
        "註解(不在畫面內)\n- 結果取代檢核面板的位置;填不滿的列出原因。\n- [清除自動排入的人] 只清 source = 自動的職責,手動排的不動。",
      );
    }
    done.push("SC-20b " + b.id);
  }

  // 3. 編輯排班:草稿 / 已發布
  const sc04 = await get("99:1600");
  const oldSc19 = await get("130:2851");
  if (sc04 && oldSc19) {
    const s19 = sc04.clone();
    sc04.parent.appendChild(s19);
    s19.name = "SC-19 Overlay / 編輯已發布的排班(異動原因必填)";
    const head = s19.findOne(
      (n) => n.type === "TEXT" && n.characters.startsWith("編輯排班"),
    );
    await setText(head, "編輯排班 · 李小華 10/14(三) · 已發布");
    for (const t of s19.findAll(
      (n) => n.type === "TEXT" && /異動原因/.test(n.characters),
    ))
      await setText(t, "異動原因(必填)");
    // 草稿時不顯示異動原因與說明
    for (const id of ["99:1675", "99:1682"]) {
      const n = await get(id);
      if (n) n.visible = false;
    }
    oldSc19.remove();
    const cap = await get("150:22605");
    if (cap) {
      cap.name = s19.name + " · 註解";
      await setText(
        cap,
        "註解(不在畫面內)\n- 已發布的排班,任何異動(改時間、刪除、換人)都要選異動原因。\n- 寫入異動紀錄;當事人收到「排班異動」通知。",
      );
    }
    done.push("SC-19 " + s19.id);
  }
  return done;
}

if (PART === "tm") {
  const DIALOGS = [
    "99:1600",
    "130:2745",
    "222:21925",
    "222:21949",
    "225:42388",
    "222:21785",
    "130:2880",
    "222:21973",
    "222:22033",
    "130:3044",
    "130:3606",
    "130:3654",
    "130:3686",
    "130:3723",
  ];
  const REMOVE_OLD = ["130:29326", "130:29517", "130:29840"];
  const MOBILE_TPL = "130:29679"; // SC-04 · 手機(全螢幕對話框殼);產生完再刪
  const page = await figma.getNodeByIdAsync("70:14");
  await figma.setCurrentPageAsync(page);
  async function fnt(t) {
    for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
      await figma.loadFontAsync(f);
  }
  async function setT(t, s) {
    await fnt(t);
    t.characters = s;
  }
  const sec = (l) =>
    page.children.find((n) => n.type === "SECTION" && n.name === l);
  function fileIn(l, n) {
    const s = sec(l);
    const right = s.children.reduce((m, c) => Math.max(m, c.x + c.width), 0);
    s.appendChild(n);
    n.x = right + 120;
    n.y = 160;
  }
  const FORM =
    /TextField|SelectField|Checkbox|Radio|Switch|DatePicker|OrgTree|Autocomplete/;
  const hasForm = (d) =>
    !!d.findOne(
      (n) =>
        (n.type === "INSTANCE" && FORM.test(n.name)) ||
        (n.type === "FRAME" && /^(table|chips)$/.test(n.name)),
    );
  const label = (b) => {
    const t = b.findOne((x) => x.type === "TEXT");
    return t ? t.characters.trim() : "";
  };
  function vert(n) {
    // 手機:欄位並排的列改成上下排
    for (const r of n.findAll(
      (x) => x.type === "FRAME" && x.name === "grid-row",
    ))
      if (r.layoutMode === "HORIZONTAL") {
        r.layoutMode = "VERTICAL";
        r.itemSpacing = Math.max(12, r.itemSpacing);
        for (const k of r.children) {
          k.layoutSizingHorizontal = "FILL";
          k.layoutSizingVertical = "HUG";
        }
      }
    for (const g of n.findAll(
      (x) => x.type === "FRAME" && /^grid(-row)?$/.test(x.name),
    )) {
      g.primaryAxisSizingMode = "AUTO";
      if (g.parent.layoutMode && g.parent.layoutMode !== "NONE")
        g.layoutSizingVertical = "HUG";
    }
    // 表格:各欄平均分配寬度,不超出畫面
    for (const tb of n.findAll((x) => x.type === "FRAME" && x.name === "table"))
      for (const r of tb.children)
        if (r.type === "FRAME" && r.layoutMode === "HORIZONTAL") {
          r.layoutSizingHorizontal = "FILL";
          for (const td of r.children) td.layoutSizingHorizontal = "FILL";
        }
  }
  const tpl = await figma.getNodeByIdAsync(MOBILE_TPL);
  const out = [];
  for (const id of DIALOGS) {
    const desk = await figma.getNodeByIdAsync(id);
    if (!desk) continue;
    const ds = desk.children[0];
    const d = ds.name === "dialog" ? ds : ds.children[0];
    // 電腦版置中
    ds.x = Math.round((desk.width - ds.width) / 2);
    ds.y = Math.max(64, Math.round((desk.height - ds.height) / 2));
    const code = /^(SC-\d\d[a-c]?)/.exec(desk.name)[1];
    const title = desk.name.replace(/^SC-\d\d[a-c]? (Overlay \/ )?/, "");
    // 平板
    const t = figma.createFrame();
    t.name = `${code} · 平板 ${title}`;
    t.resize(1024, 768);
    t.fills = desk.fills;
    t.clipsContent = false;
    const td = d.clone();
    t.appendChild(td);
    td.x = Math.round((1024 - td.width) / 2);
    td.y = Math.max(48, Math.round((768 - td.height) / 2));
    fileIn("平板 1024", t);
    // 手機
    let m;
    if (hasForm(d)) {
      m = tpl.clone();
      m.name = `${code} · 手機 ${title}`;
      const main = m.children.find((n) => n.name === "main");
      const bar = main.children.find((n) => n.type === "INSTANCE");
      const c = main.children.find((n) => n.name === "content");
      for (const k of [...c.children]) k.remove();
      const head = d.children.find((n) => n.name === "head");
      const ht = head && head.findOne((x) => x.type === "TEXT");
      const acts = d.children.find((n) => n.name === "actions");
      const btns = acts
        ? acts.findAll((x) => x.type === "INSTANCE" && x.name === "Button")
        : [];
      const primary = btns[btns.length - 1];
      bar.setProperties({
        "Title#209:0": ht ? ht.characters : title,
        "Action#209:14": !!primary,
      });
      const at = bar
        .findAll((x) => x.type === "TEXT")
        .find((x) => x.characters === "儲存");
      if (at && primary) await setT(at, label(primary));
      for (const k of d.children) {
        if (k === head || k === acts) continue;
        const cl = k.clone();
        c.appendChild(cl);
        if (cl.type !== "TEXT" || cl.textAutoResize !== "WIDTH_AND_HEIGHT")
          cl.layoutSizingHorizontal = "FILL";
        else {
          cl.textAutoResize = "HEIGHT";
          cl.layoutSizingHorizontal = "FILL";
        }
      }
      const extra = btns.filter((b) => b !== primary && label(b) !== "取消");
      if (extra.length) {
        const row = figma.createAutoLayout("HORIZONTAL", {
          name: "more-actions",
          itemSpacing: 8,
        });
        row.fills = [];
        c.appendChild(row);
        row.layoutSizingHorizontal = "FILL";
        for (const b of extra) row.appendChild(b.clone());
      }
      vert(c);
    } else {
      m = figma.createFrame();
      m.name = `${code} · 手機 ${title}`;
      m.resize(390, 844);
      m.fills = desk.fills;
      m.clipsContent = false;
      const md = d.clone();
      m.appendChild(md);
      md.counterAxisSizingMode = "FIXED";
      md.resize(342, md.height);
      for (const k of md.children)
        if (k.type !== "TEXT" || k.textAutoResize === "HEIGHT")
          k.layoutSizingHorizontal = "FILL";
      vert(md);
      md.x = 24;
      md.y = Math.round((844 - md.height) / 2);
    }
    fileIn("手機 390", m);
    out.push([code, t.id, m.id]);
  }
  for (const id of [...REMOVE_OLD, MOBILE_TPL]) {
    const n = await figma.getNodeByIdAsync(id);
    if (n) n.remove();
  }
  return out;
}

if (PART === "new") {
  // ==== PART "new":流程中缺的步驟(三尺寸)====
  // SC-32 今天沒有排班(空狀態)、SC-33 排班表只能檢視(沒有編輯權限,看不到按鈕)、SC-34 刪除排班確認、
  // SC-35 排班表:這個月還沒有人力需求(空狀態)、SC-36 全部重排確認、SC-37 清除自動排入的人確認;
  // SC-15b 已發布的平板 / 手機與 [自動排班] 隱藏;SC-20b 自動排班結果的平板 / 手機。
  const page = await figma.getNodeByIdAsync("70:14");
  await figma.setCurrentPageAsync(page);
  const get = (id) => figma.getNodeByIdAsync(id);
  async function fnt(t) {
    for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
      await figma.loadFontAsync(f);
  }
  async function setT(t, s) {
    await fnt(t);
    t.characters = s;
  }
  const sec = (l) =>
    page.children.find((n) => n.type === "SECTION" && n.name === l);
  function fileIn(l, n) {
    const s = sec(l);
    const right = s.children.reduce((m, c) => Math.max(m, c.x + c.width), 0);
    s.appendChild(n);
    n.x = right + 120;
    n.y = 160;
  }
  const btnText = (b) => b.findOne((x) => x.type === "TEXT");
  const findBtn = (root, l) =>
    root
      .findAll((x) => x.type === "INSTANCE" && x.name === "Button")
      .filter((b) => btnText(b) && btnText(b).characters.trim() === l);
  const contentOf = (f) =>
    f.children
      .find((n) => n.name === "main")
      .children.find((n) => n.name === "content");
  const out = {};
  const SC03 = { d: "70:15", t: "130:29192", m: "130:29593" };
  const SC01 = { d: "223:4466", t: "130:28360", m: "130:28804" };
  const SZ = {
    d: ["電腦 1440", ""],
    t: ["平板 1024", " · 平板"],
    m: ["手機 390", " · 手機"],
  };

  // --- 小確認視窗(電腦 / 平板 / 手機)---
  const TPL = await get("222:21881"); // SC-15a 電腦
  async function confirm3(code, name, head, body, okLabel, danger) {
    const ids = [];
    for (const k of ["d", "t", "m"]) {
      const W = k === "d" ? [1440, 900] : k === "t" ? [1024, 768] : [390, 844];
      const f = figma.createFrame();
      f.name = `${code}${SZ[k][1]} ${k === "d" ? "Overlay / " : ""}${name}`;
      f.resize(W[0], W[1]);
      f.fills = TPL.fills;
      f.clipsContent = false;
      const d = TPL.children[0].children[0].clone();
      f.appendChild(d);
      d.name = "dialog:" + head;
      const kv = d.children.find((n) => n.name === "kv");
      if (kv) kv.remove();
      await setT(
        d.children
          .find((n) => n.name === "head")
          .findOne((x) => x.type === "TEXT"),
        head,
      );
      await setT(
        d.children.find((n) => n.type === "TEXT"),
        body,
      );
      const bs = d.children
        .find((n) => n.name === "actions")
        .findAll((x) => x.type === "INSTANCE" && x.name === "Button");
      const ok = bs[bs.length - 1];
      await setT(btnText(ok), okLabel);
      if (danger) ok.setProperties({ Color: "Error" });
      if (k === "m") {
        d.counterAxisSizingMode = "FIXED";
        d.resize(342, d.height);
        for (const c of d.children) {
          if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
          c.layoutSizingHorizontal = "FILL";
        }
      }
      d.x = Math.round((W[0] - d.width) / 2);
      d.y = Math.round((W[1] - d.height) / 2);
      fileIn(SZ[k][0], f);
      ids.push(f.id);
    }
    out[code] = ids;
  }
  await confirm3(
    "SC-34",
    "刪除排班確認",
    "刪除這筆排班?",
    "李小華 10/14(三)09:00–17:00 · 店內櫃台負責人、補貨協同。刪除後這兩個職責一起移除。",
    "刪除",
    true,
  );
  await confirm3(
    "SC-36",
    "全部重排確認",
    "全部重排 11 月?",
    "11 月所有排班(包括手動排的)都會清除後重新排入,不能復原。",
    "全部重排",
    true,
  );
  await confirm3(
    "SC-37",
    "清除自動排入的人確認",
    "清除自動排入的人?",
    "11 月自動排入的 171 個職責會移除,手動排的不動。",
    "清除",
    true,
  );

  // --- 排班表變體(複製 SC-03 三尺寸)---
  async function rosterVariant(code, name, fn) {
    const ids = [];
    for (const k of ["d", "t", "m"]) {
      const f = (await get(SC03[k])).clone();
      f.name = `${code}${SZ[k][1]} ${name}`;
      await fn(f, k);
      fileIn(SZ[k][0], f);
      ids.push(f.id);
    }
    out[code] = ids;
  }
  const hideBtns = (f, labels) => {
    for (const l of labels) for (const b of findBtn(f, l)) b.visible = false;
  };
  await rosterVariant("SC-33", "排班表:只能檢視(沒有編輯權限)", async (f) => {
    hideBtns(f, ["套用範本", "自動排班", "發布", "+ 新增排班"]);
    const tag = f.findOne(
      (x) => x.type === "INSTANCE" && x.name === "Draft/Tag",
    );
    if (tag) tag.setProperties({ "Label#76:8": "已發布", Tone: "Success" });
    const al = contentOf(f).children.find(
      (x) => x.type === "INSTANCE" && x.name === "Draft/Alert",
    );
    if (al) al.visible = false;
  });
  const panelSrc = await get("70:737"); // 人力需求卡片(底色、框線、圓角)
  await rosterVariant("SC-35", "排班表:這個月還沒有人力需求", async (f, k) => {
    const c = contentOf(f);
    for (const n of [...c.children])
      if (
        /^(Draft\/RosterGrid|panels|table|chips|day)$/.test(n.name) ||
        (n.type === "INSTANCE" && n.name === "Draft/Alert")
      )
        n.remove();
    for (const t of f.findAll(
      (x) => x.type === "TEXT" && x.characters === "2026 年 10 月",
    ))
      await setT(t, "2026 年 11 月");
    const p = figma.createAutoLayout("VERTICAL", {
      name: "empty",
      itemSpacing: 12,
      paddingTop: 48,
      paddingBottom: 48,
      paddingLeft: 24,
      paddingRight: 24,
      counterAxisAlignItems: "CENTER",
    });
    p.fills = panelSrc.fills;
    p.strokes = panelSrc.strokes;
    p.strokeWeight = panelSrc.strokeWeight;
    p.cornerRadius =
      typeof panelSrc.cornerRadius === "number" ? panelSrc.cornerRadius : 8;
    c.appendChild(p);
    p.layoutSizingHorizontal = "FILL";
    const h = panelSrc.children[0].clone();
    p.appendChild(h);
    await setT(h, "11 月還沒有人力需求");
    const b = (await get("222:21890")).clone();
    p.appendChild(b);
    await setT(b, "先套用週範本建立人力需求,再手動排班或自動排班。");
    b.textAlignHorizontal = "CENTER";
    if (k === "m") {
      b.textAutoResize = "HEIGHT";
      b.layoutSizingHorizontal = "FILL";
    }
    const nb = findBtn(f, "套用範本")[0].clone();
    p.appendChild(nb);
    nb.setProperties({ Variant: "Contained" });
    await setT(btnText(nb), "套用週範本");
  });

  // --- SC-15b 已發布:電腦版隱藏 [自動排班];平板 / 手機 ---
  for (const b of findBtn(await get("223:5639"), "自動排班")) b.visible = false;
  const ids15 = [];
  for (const k of ["t", "m"]) {
    const f = (await get(SC03[k])).clone();
    f.name = `SC-15b${SZ[k][1]} 排班表:已發布`;
    hideBtns(f, ["自動排班", "發布"]);
    const tag = f.findOne(
      (x) => x.type === "INSTANCE" && x.name === "Draft/Tag",
    );
    if (tag) tag.setProperties({ "Label#76:8": "已發布", Tone: "Success" });
    fileIn(SZ[k][0], f);
    ids15.push(f.id);
  }
  out["SC-15b"] = ids15;

  // --- SC-20b 自動排班結果:平板 / 手機(排班表 + 結果卡片)---
  const res = (await get("225:41945")).findOne(
    (x) => x.type === "FRAME" && x.name === "結果",
  );
  const ids20 = [];
  for (const k of ["t", "m"]) {
    const f = (await get(SC03[k])).clone();
    f.name = `SC-20b${SZ[k][1]} 自動排班結果`;
    const r = res.clone();
    contentOf(f).appendChild(r);
    r.layoutSizingHorizontal = "FILL";
    for (const tb of r.findAll((x) => x.type === "FRAME" && x.name === "table"))
      for (const row of tb.children)
        if (row.type === "FRAME" && row.layoutMode === "HORIZONTAL") {
          row.layoutSizingHorizontal = "FILL";
          for (const td of row.children) td.layoutSizingHorizontal = "FILL";
        }
    const hd = r.findOne((x) => x.name === "result-head");
    if (hd && k === "m") {
      hd.layoutMode = "VERTICAL";
      hd.counterAxisAlignItems = "MIN";
    }
    fileIn(SZ[k][0], f);
    ids20.push(f.id);
  }
  out["SC-20b"] = ids20;

  // --- SC-32 今天沒有排班(複製 SC-01 三尺寸)---
  const ids32 = [];
  const btnSrc = findBtn(await get("70:15"), "套用範本")[0];
  for (const k of ["d", "t", "m"]) {
    const f = (await get(SC01[k])).clone();
    f.name = `SC-32${SZ[k][1]} 班表與打卡:今天沒有排班`;
    for (const n of f.findAll(
      (x) => x.type === "FRAME" && /^(today|yesterday)$/.test(x.name),
    ))
      n.remove();
    for (const a of f.findAll(
      (x) => x.type === "INSTANCE" && x.name === "Draft/Alert",
    ))
      a.visible = false;
    const s = f.findOne(
      (x) => x.type === "INSTANCE" && x.name === "Draft/Section",
    );
    s.setProperties({ State: "Expanded", "Summary#41:3": "今天沒有排班" });
    const slot = s.findOne((x) => x.type === "SLOT");
    if (slot) {
      for (const ch of [...slot.children]) ch.remove();
      const tx = (await get("222:21890")).clone();
      slot.appendChild(tx);
      await setT(tx, "臨時被叫來幫忙時,在這裡打卡;下班時按 [打下班卡]。");
      tx.textAutoResize = "HEIGHT";
      tx.layoutSizingHorizontal = "FILL";
      const row = figma.createAutoLayout("HORIZONTAL", {
        name: "punch-actions",
        itemSpacing: 8,
      });
      row.fills = [];
      slot.appendChild(row);
      for (const [l, v] of [
        ["打上班卡", "Contained"],
        ["打下班卡", "Outlined"],
      ]) {
        const b = btnSrc.clone();
        row.appendChild(b);
        b.setProperties({ Variant: v });
        await setT(btnText(b), l);
      }
    }
    fileIn(SZ[k][0], f);
    ids32.push(f.id);
  }
  out["SC-32"] = ids32;
  return out;
}

// PART "post":示範資料與版面收尾(SC-35 / SC-20b 改成 11 月、結果面板高度、超出的欄位)
if (PART === "post") {
  const page = await figma.getNodeByIdAsync("70:14");
  await figma.setCurrentPageAsync(page);
  async function fnt(t) {
    for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
      await figma.loadFontAsync(f);
  }
  const named = (re) =>
    page
      .findAll((n) => n.type === "FRAME" && re.test(n.name))
      .filter((n) => n.parent.type === "SECTION");
  for (const f of named(/^SC-(35|20b)/))
    for (const t of f.findAll((x) => x.type === "TEXT")) {
      const r = t.characters
        .replace(/\b10\/(1[1-7])\b/g, (m, d) => "11/0" + (Number(d) - 10))
        .replace(/2026 年 10 月/g, "2026 年 11 月");
      if (r !== t.characters) {
        await fnt(t);
        t.characters = r;
      }
    }
  for (const f of named(/^SC-20b/)) {
    const res = f.findOne((x) => x.type === "FRAME" && x.name === "結果");
    if (res && res.parent.layoutMode) res.layoutSizingVertical = "HUG";
    const hd = f.findOne((x) => x.name === "result-head");
    const t = hd && hd.children.find((x) => x.type === "TEXT");
    if (t) {
      t.layoutGrow = hd.layoutMode === "VERTICAL" ? 0 : 1;
      t.textAutoResize = "HEIGHT";
      if (hd.layoutMode === "VERTICAL") t.layoutSizingHorizontal = "FILL";
    }
  }
  // 手機全螢幕對話框:表格裡的下拉撐滿欄寬
  for (const f of named(/^SC-(04|19) · 手機/))
    for (const sel of f.findAll(
      (x) =>
        x.type === "INSTANCE" &&
        /SelectField/.test(x.name) &&
        x.parent.name === "td",
    ))
      sel.layoutSizingHorizontal = "FILL";
  return "ok";
}
