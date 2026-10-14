// 本輪底座參考畫面(底座規格 13 畫面清單 BS-01~21)。第十九輪起改成「以現有底座畫面為底,只畫差異」。
// 前置:`const PROJECT = false; const PART = 1 | 2 | 3 | 4 | 5;` + _kit.js + Base-ref.js(MODE 改成 base 時在 wowgo-base 本檔執行)。
// 每張畫面先複製現有的 `Screen / Admin …` 畫面(依名稱找),側欄、頁首、分頁、卡片、表格、欄位、按鈕都沿用現有的;
// 只加上底座規格寫的改動,框外註解寫「對應現有畫面 + 本輪改動」。對話框的背景是打開它的畫面。全部跑完再跑 project/r4-layout.js 分列。
// PART 1 = 資料範圍、流程設計器(BS-01~03);2 = 表單模組、個人設定、申請中心(BS-04~07);
// 3 = 通知、通知設定、表單設計器、欄位管理(BS-08、09、12、13、21);4 = 印表機管理(BS-10、17~20);5 = 元件示範(BS-11、14、15、16)。
await toDraftPage();
const Y = bottomY(400);
const orgChip = async (s) => {
  const c = H(4, {
    name: "chip",
    paddingLeft: 8,
    paddingRight: 6,
    paddingTop: 2,
    paddingBottom: 2,
  });
  c.fills = [await paint("action/selected")];
  c.cornerRadius = 12;
  await put(c, [
    await T(s, "Body/2"),
    await T("✕", "Caption", "text/secondary"),
  ]);
  return c;
};
const fin = (sh) => {
  const n = typeof sh.type === "string" ? sh : sh.s; // 節點本身沒有 .s(存取會丟錯)
  place(n, Y);
  made.push([n.name, n.id]);
  return n;
};
const hug = (...ns) => {
  for (const n of ns)
    if (n && "layoutSizingVertical" in n) n.layoutSizingVertical = "HUG";
};
const wrapText = (root) => {
  for (const t of root.findAll(
    (n) => n.type === "TEXT" && n.layoutSizingHorizontal === "FILL",
  ))
    t.textAutoResize = "HEIGHT";
};
// 審核者摘要(B3:審核者來源改人員條件;關卡面板寬度有限,條件在對話框裡編輯)
async function approverBox(label, text) {
  const box = V(6, {
    name: "approver-summary",
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 10,
  });
  box.fills = [await paint("bg/default")];
  await rad(box, "radius/sm");
  add(box, await T(label, "Caption", "text/secondary"));
  add(box, await T(text, "Body/2"), "FILL").textAutoResize = "HEIGHT";
  add(box, await btn("編輯條件", "Outlined", "Primary", "Default", "Small"));
  return box;
}
// 流程設計器:關卡面板的「審核者來源 / 角色」換成人員條件
async function flowDesigner(name, shared) {
  const sh = await refShell("Admin 流程管理 — 流程設計(側欄收合)", name);
  const se = q(sh.s, "StepEditor");
  const src = fieldBy(se, "審核者來源");
  if (src) await setField(src, "審核者來源", "人員條件");
  const role = fieldBy(se, "角色");
  const box = await approverBox(
    "審核者",
    shared
      ? "權限 持有「示範模組 · 核准」且 所屬組織 屬於【單據所屬組織】(本身)"
      : "角色 屬於 財務 且 所屬組織 屬於【申請人的組織】(本身)",
  );
  se.insertChild(role ? se.children.indexOf(role) : 6, box);
  box.layoutSizingHorizontal = "FILL";
  if (role) role.remove();
  // 畫布上的關卡卡片與問題清單:「角色」改成審核者(人員條件)
  for (const [a, b] of [
    ["角色:財務", "審核者:人員條件"],
    ["角色:未設定", "審核者:未設定"],
    ["沒有選角色", "沒有設定審核者"],
  ])
    for (const t of sh.s.findAll(
      (n) => n.type === "TEXT" && n.characters.includes(a),
    )) {
      await fonts({ findAll: () => [t] });
      t.characters = t.characters.replace(a, b);
    }
  if (shared) {
    const sub = sh.s.findOne(
      (n) => n.type === "TEXT" && n.characters.includes("客製流程"),
    );
    if (sub) {
      await fonts({ findAll: () => [sub] });
      sub.characters = sub.characters.replace("客製流程", "共用流程");
    }
  }
  return { sh, se };
}

if (PART === 1) {
  // ---- BS-01 資料範圍:新規則卡 ----
  {
    const sh = await refShell(
      "Admin 資料範圍",
      "BS-01 資料範圍:新規則卡(套用對象 + 條件組合)",
    );
    const ed = q(sh.s, "RuleEditor");
    if (
      !ed.children.some(
        (n) => n.type === "INSTANCE" && /DataScopeRuleCard/.test(n.name),
      )
    ) {
      // 底座檔的現有畫面還是舊規則卡:中間的規則卡換成新卡
      const old = [...ed.children].slice(3, -1);
      const at = ed.children.indexOf(old[0]);
      for (const o of old) o.remove();
      for (let i = 0; i < 2; i++) {
        const c = (await dcomp("Draft/DataScopeRuleCard")).createInstance();
        ed.insertChild(at + i, c);
        c.layoutSizingHorizontal = "FILL";
      }
    }
    await refNote(
      sh,
      "規則卡的「套用對象」改成人員條件(所有人 / 符合條件;欄位:使用者、角色、所屬組織、權限,最多 3 層);條件組合、規則合成、資料目標清單不變。",
    );
    fin(sh);
  }
  // ---- BS-02 流程設計器:審核者來源(客製 / 共用)----
  {
    const a = await flowDesigner(
      "BS-02a 流程設計器:審核者來源(客製流程)",
      false,
    );
    await refNote(
      a.sh,
      "關卡面板的「審核者來源」多了「人員條件」(取代指定使用者與角色),下方顯示條件摘要,[編輯條件] 開啟條件對話框;表單欄位、主管兩種來源不變。",
    );
    fin(a.sh);
    const ov = await refOverlay(
      a.sh,
      "BS-02b Overlay / 審核者條件(客製流程)",
      860,
    );
    await ov.body(
      "審核者條件 · 財務複核",
      [
        await dvar(
          "Draft/AudiencePicker",
          "AllowEveryone=False, Value=Conditions",
        ),
      ],
      [await btn("取消", "Text"), await btn("套用")],
    );
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    await noteOut(
      ov.s,
      "本輪改動:條件用 AudiencePicker 編輯(與資料範圍共用條件樹)。",
    );
    fin(ov);
    const c = await flowDesigner(
      "BS-02c 流程設計器:審核者來源(共用流程)",
      true,
    );
    await refNote(c.sh, "共用流程:條件只能用權限與非指定的組織來源。");
    fin(c.sh);
    const ov2 = await refOverlay(
      c.sh,
      "BS-02d Overlay / 審核者條件(共用流程)",
      860,
    );
    const ap = await dvar(
      "Draft/AudiencePicker",
      "AllowEveryone=False, Value=Conditions",
    );
    const rows = ap.findAll((n) => n.name === "condition-row");
    const setSel = async (row, idx, val) => {
      const s = row.children.filter(
        (x) =>
          x.type === "INSTANCE" &&
          Object.keys(x.componentProperties).some((k) => k.startsWith("Value")),
      )[idx];
      await setProps(s, { Value: val });
    };
    const setChip = async (row, val) => {
      const t = row
        .findOne((n) => n.name === "value-chips")
        .findOne((n) => n.type === "TEXT");
      await fonts({ findAll: () => [t] });
      t.characters = val;
    };
    await setSel(rows[0], 0, "權限");
    await setSel(rows[0], 1, "持有");
    await setChip(rows[0], "示範模組 · 核准");
    await setSel(rows[1], 2, "【單據所屬組織】");
    await setSel(rows[1], 3, "本身");
    await setSel(rows[2], 0, "所屬組織");
    await setSel(rows[2], 1, "屬於");
    await setChip(rows[2], "【最上層組織】");
    await ov2.body(
      "審核者條件 · 主管審核(共用流程)",
      [
        await alert(
          "共用流程給所有租戶用,條件只能用「權限」與組織來源(單據所屬組織、表單的組織欄位、最上層組織)。",
          "Warning",
        ),
        ap,
      ],
      [await btn("取消", "Text"), await btn("套用")],
    );
    ov2.center();
    await noteOut(ov2.s, "對應現有畫面:" + ov2.src);
    await noteOut(
      ov2.s,
      "本輪改動:共用流程用到使用者或角色會擋下(AUDIENCE_IN_SHARED)。",
    );
    fin(ov2);
  }
  // ---- BS-03 流程設計器:每一關跳過、自動通過、逾時提醒、知會 ----
  {
    const { sh, se } = await flowDesigner(
      "BS-03 流程設計器 每一關:跳過、自動通過、逾時提醒、知會",
      false,
    );
    const at = se.children.indexOf(q(se, "actions-1"));
    const parts = [];
    const skip = V(8, { name: "B4 指定組織跳過" });
    add(skip, await T("跳過", "Subtitle/2"));
    add(
      skip,
      await T("申請人屬於下列組織時,跳過這一關:", "Body/2"),
      "FILL",
    ).textAutoResize = "HEIGHT";
    const orgs = add(
      skip,
      H(6, { name: "orgs", layoutWrap: "WRAP", counterAxisSpacing: 6 }),
      "FILL",
    );
    await put(orgs, [
      await orgChip("最上層組織"),
      await orgChip("示範分店 A"),
      await btn("+ 選擇組織", "Text", "Primary", "Default", "Small"),
    ]);
    add(skip, await check("包含下層組織"));
    parts.push(skip);
    const auto = V(8, { name: "B5 自動通過" });
    add(auto, await T("自動通過", "Subtitle/2"));
    add(auto, await T("申請人是這一關的審核者時", "Body/2", "text/secondary"));
    await put(add(auto, H(16)), [
      await radio("照常審核", true),
      await radio("自動通過"),
    ]);
    add(
      auto,
      await T("審核者已在前面的關卡核准過時", "Body/2", "text/secondary"),
    );
    await put(add(auto, H(16)), [
      await radio("照常審核"),
      await radio("自動通過", true),
    ]);
    parts.push(auto);
    const remind = V(8, { name: "B16 逾時提醒" });
    add(remind, await T("逾時提醒", "Subtitle/2"));
    await put(add(remind, H(8)), [
      await T("超過"),
      await field("", "24", { w: 72 }),
      await T("小時未處理 → 通知審核者"),
    ]);
    await put(add(remind, H(8)), [
      await T("超過"),
      await field("", "48", { w: 72 }),
      await T("小時 → 同時通知"),
    ]);
    add(remind, await approverBox("通知對象", "角色 屬於 流程管理者"), "FILL");
    await cap(remind, "只提醒,不會自動核准或駁回。");
    parts.push(remind);
    const cc = V(8, { name: "B17 知會" });
    add(cc, await T("知會", "Subtitle/2"));
    await put(add(cc, H(16)), [
      await radio("通過這一關時", true),
      await radio("流程完成時"),
    ]);
    add(cc, await approverBox("知會對象", "角色 屬於 人資"), "FILL");
    await cap(cc, "知會對象不用審核,看得到這張單據(唯讀)。");
    parts.push(cc);
    for (const [i, p] of parts.entries()) {
      se.insertChild(at + i, p);
      p.layoutSizingHorizontal = "FILL";
    }
    wrapText(se);
    hug(
      se,
      q(sh.s, "FlowDesignerWorkspace"),
      q(sh.s, "WorkflowDetailPanel"),
      q(sh.s, "body"),
    );
    await noteOut(
      sh.s,
      "跳過:判斷申請人所屬的組織(全部);與既有跳過條件任一成立就跳過;被跳過的關卡不執行 beforeApprove。",
    );
    await refNote(
      sh,
      "關卡面板加四個區塊:跳過(B4 指定組織)、自動通過(B5)、逾時提醒(B16,通知對象用人員條件)、知會(B17);既有欄位(名稱、key、審核者、會簽、允許退回、跳過條件)不變。",
    );
    fin(sh);
  }
}

if (PART === 2) {
  // ---- BS-04 表單模組綁多張表單:[+ 新增] 依表單權限;發布後提示授予權限 ----
  {
    const list = await refShell(
      "Admin 示範表單 — 列表",
      "BS-04a 表單模組 列表(背景)",
    );
    const ov = await refOverlay(
      list,
      "BS-04a Overlay / [+ 新增] 選擇表單(依表單新增權限)",
      444,
    );
    // 沿用現有「選擇要填寫的表單」的清單,只列有新增權限的表單
    const src = await refFrame("Overlay / 選擇要填寫的表單");
    const lst = src.findOne((n) => n.name === "可填寫的表單").clone();
    await rebase(lst);
    const items = lst.children.filter((n) => n.type === "INSTANCE");
    if (items.length > 2) items[items.length - 1].remove();
    await ov.body("選擇要填寫的表單", [lst], [await btn("取消", "Text")]);
    ov.center();
    list.s.remove();
    await noteOut(
      ov.s,
      "對應現有畫面:Admin 示範表單 — 列表 + Overlay / 選擇要填寫的表單",
    );
    await noteOut(
      ov.s,
      "本輪改動:模組開啟依表單新增權限(B9b)時,清單只列有「<表單名> 新增」權限的表單;只剩一張時直接開新增頁。底座示範表單模組不開啟。",
    );
    fin(ov);
    const ver = await refShell(
      "Admin 表單管理 — 表單版本",
      "BS-04b 表單版本(背景)",
    );
    const ov2 = await refOverlay(
      ver,
      "BS-04b Overlay / 表單發布成功:提示授予新增權限",
      600,
    );
    await ov2.body(
      "發布成功",
      [
        await T("「請假申請單(租戶客製)」第 3 版已發布。", "Body/1"),
        await alert(
          "已建立權限「請假申請單 新增」,不會自動授予。請到角色管理授予需要的角色。",
          "Warning",
        ),
      ],
      [await btn("稍後", "Text"), await btn("前往角色管理")],
    );
    ov2.center();
    ver.s.remove();
    await noteOut(
      ov2.s,
      "對應現有畫面:Admin 表單管理 — 表單版本 + Overlay / 發布新版本",
    );
    await noteOut(
      ov2.s,
      "本輪改動:租戶複製的客製表單發布後,提示到角色管理授予新增權限。",
    );
    fin(ov2);
  }
  // ---- BS-05 / BS-06 個人設定(新頁;版型沿用申請中心的卡片 + 分頁)----
  const prefsShell = async (name, tab) => {
    const sh = await refShell("Admin 申請中心 — 我的申請", name);
    await retitle(sh, "申請中心", "個人設定");
    await navActive(sh, null);
    const cardF = q(sh.s, "ApplyCenterCard");
    const tabs = q(cardF, "tabs").children.filter((n) => n.type === "INSTANCE");
    await setProps(tabs[0], {
      Label: "偏好",
      Badge: false,
      State: tab === "偏好" ? "Active" : "Default",
    });
    await setProps(tabs[1], {
      Label: "代理人",
      Badge: false,
      State: tab === "代理人" ? "Active" : "Default",
    });
    const topBtn = q(cardF, "top").findChild(
      (n) => n.type === "INSTANCE" && /Button/.test(n.name),
    );
    q(cardF, "ApplyCenterFilters").remove();
    return { sh, cardF, topBtn };
  };
  {
    const { sh, cardF, topBtn } = await prefsShell(
      "BS-05 個人設定 偏好",
      "偏好",
    );
    topBtn.remove();
    const dt = q(cardF, "DataTable");
    const at = cardF.children.indexOf(dt);
    const body = V(16, { name: "prefs" });
    cardF.insertChild(at, body);
    body.layoutSizingHorizontal = "FILL";
    add(body, await T("語言", "Subtitle/2"));
    add(body, await select("語言", "繁體中文", 280));
    add(body, await T("通知管道", "Subtitle/2"));
    add(body, dt, "FILL");
    const swc = (on) =>
      inst("Switch", { State: on ? "On" : "Off", Enabled: "True" });
    await refTable(
      dt,
      [
        ["通知類型", 520],
        ["站內通知", 200],
        ["Email", 200],
      ],
      [
        ["待你審核", await swc(1), await swc(1)],
        ["單據被退回", await swc(1), await swc(0)],
        ["審核逾時提醒", await swc(1), await swc(0)],
        ["知會", await swc(1), await swc(0)],
      ],
      { noFoot: true },
    );
    const pager = q(cardF, "TablePager");
    if (pager) pager.remove();
    add(body, await actions([await btn("儲存")]), "FILL");
    await noteOut(
      sh.s,
      "語言與通知管道跟著帳號(user_preferences);外觀(亮 / 暗)、側欄收合跟著這台瀏覽器,在頭像選單調整。",
    );
    await refNote(
      sh,
      "新頁(頭像選單 → 個人設定),版型沿用申請中心的卡片 + 分頁;分頁:偏好 | 代理人。",
    );
    fin(sh);
  }
  {
    const { sh, cardF, topBtn } = await prefsShell(
      "BS-06a 個人設定 代理人",
      "代理人",
    );
    await setProps(topBtn, { Label: "+ 新增代理" });
    const dt = q(cardF, "DataTable");
    const al1 = await alert(
      "代理期間內,輪到你審核的任務改派給代理人。代理開始前已派給你的任務不會自動轉移。",
      "Info",
    );
    cardF.insertChild(cardF.children.indexOf(dt), al1);
    al1.layoutSizingHorizontal = "FILL";
    await refTable(
      dt,
      [
        ["代理人", 200],
        ["開始", 200],
        ["結束", 200],
        ["備註", 268],
        ["狀態", 100],
        ["", 120],
      ],
      [
        [
          "李小華",
          "2026-10-20 00:00",
          "2026-10-24 23:59",
          "出國",
          await tag("未開始"),
          await btn("刪除", "Text", "Error", "Default", "Small"),
        ],
        [
          "陳大文",
          "2026-09-01 00:00",
          "2026-09-03 23:59",
          "",
          await tag("已結束"),
          "",
        ],
      ],
      { footer: "共 2 筆" },
    );
    await refNote(sh, "個人設定的「代理人」分頁(B15)。");
    fin(sh);
    const ov = await refOverlay(sh, "BS-06b Overlay / 新增代理", 480);
    const g = H(12, { name: "range" });
    await put(g, [
      await field("開始", "2026-10-20 00:00"),
      await field("結束", "2026-10-24 23:59"),
    ]);
    const sel = await select("代理人", "李小華");
    const note = await field("備註", "出國");
    await ov.body(
      "新增代理",
      [sel, g, note],
      [await btn("取消", "Text"), await btn("新增")],
    );
    for (const n of g.children) n.layoutSizingHorizontal = "FILL";
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    await noteOut(
      ov.s,
      "本輪改動:代理人必須是本租戶啟用中的使用者;代理人是申請人時,那張單據仍由原審核者審核。",
    );
    fin(ov);
  }
  // ---- BS-07 申請中心 待我審核:批次核准 ----
  {
    const sh = await refShell(
      "Admin 申請中心 — 待我審核",
      "BS-07a 申請中心 待我審核:批次核准",
    );
    const cardF = q(sh.s, "ApplyCenterCard");
    const dt = q(cardF, "DataTable");
    // 勾選欄:每一列最前面加一格(寬 48),最後一欄縮 48
    const rowsF = dt.children.filter(
      (n) => n.name === "thead" || n.name === "tr",
    );
    for (const [i, r] of rowsF.entries()) {
      const first = r.children[0];
      const c = first.clone();
      clear(c);
      r.insertChild(0, c);
      c.resize(48, first.height);
      add(
        c,
        await inst("Checkbox", {
          State: i === 0 ? "Indeterminate" : i <= 2 ? "Checked" : "Unchecked",
          Enabled: "True",
        }),
      );
      const last = r.children[r.children.length - 1];
      last.resize(last.width - 48, last.height);
      if (i >= 1 && i <= 2) r.fills = [await paint("action/selected")];
    }
    const bar = H(12, {
      name: "bulk-bar",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 8,
      paddingBottom: 8,
    });
    bar.fills = [await paint("action/selected")];
    await rad(bar, "radius/sm");
    await put(bar, [
      await bold("已選 2 筆"),
      await muted("只能批次核准;駁回、退回請逐筆處理"),
    ]);
    spacer(bar);
    add(bar, await btn("核准(2)", "Contained", "Primary", "Default", "Small"));
    cardF.insertChild(cardF.children.indexOf(dt), bar);
    bar.layoutSizingHorizontal = "FILL";
    await refNote(
      sh,
      "待我審核的列表加勾選欄與批次列(B18);只支援核准,每一筆各自一個交易。",
    );
    fin(sh);
    const ov = await refOverlay(sh, "BS-07b Overlay / 批次核准結果", 600);
    await ov.body(
      "批次核准",
      [
        await field("共同意見(選填)", "同意"),
        await alert("1 筆已核准,1 筆被擋下(其他筆不受影響)", "Warning"),
        await table(
          [
            ["單號", 120],
            ["結果", 400],
          ],
          [
            ["F-0031", await okc("已核准")],
            ["F-0029", await red("被擋下:剩餘假別時數不足")],
          ],
        ),
      ],
      [await btn("關閉")],
    );
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    await noteOut(ov.s, "本輪改動:被擋下的逐筆列出原因,其他筆照常核准。");
    fin(ov);
  }
}

// 色票(底座規格 10.7):草稿暫用色碼,重建時新增 tagPalettes 變數
const PAL = [
  ["藍", "#E3F2FD", "#0D47A1"],
  ["青", "#E0F7FA", "#006064"],
  ["綠", "#E8F5E9", "#1B5E20"],
  ["萊姆", "#F1F8E9", "#33691E"],
  ["黃", "#FFF8E1", "#7A5B00"],
  ["橘", "#FFF3E0", "#9A3B00"],
  ["紅", "#FFEBEE", "#B71C1C"],
  ["粉", "#FCE4EC", "#880E4F"],
  ["紫", "#F3E5F5", "#4A148C"],
  ["灰", "#F5F5F5", "#424242"],
];
const hex = (h) => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});
async function palChip(name) {
  const p = PAL.find((x) => x[0] === name);
  const c = H(0, {
    name: "tag:" + name,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
  });
  c.fills = [{ type: "SOLID", color: hex(p[1]) }];
  c.cornerRadius = 4;
  const t = await T(name, "Caption/SemiBold");
  t.fills = [{ type: "SOLID", color: hex(p[2]) }];
  add(c, t);
  return c;
}
// 現有「示範模組1 列表」的卡片版型做成新的列表頁(通知設定)
async function listPage(name, title, cols, rows, o = {}) {
  const sh = await refShell("Admin 示範模組1 列表", name);
  await pageTitle(sh, title);
  const missing = await sysNav(sh);
  await navActive(sh, title);
  const [bar, cardF] = sh.content.children.filter((n) => n.type === "FRAME");
  const search = bar.findChild(
    (n) => n.type === "INSTANCE" && /TextField/.test(n.name),
  );
  if (search) await setProps(search, { Label: o.search || "搜尋", Value: "" });
  const addBtn = bar.findChild(
    (n) => n.type === "INSTANCE" && /Button/.test(n.name),
  );
  if (o.addLabel) await setProps(addBtn, { Label: o.addLabel });
  else if (addBtn) addBtn.remove();
  for (const t of sh.content.children.filter((n) => n.type === "TEXT"))
    t.remove();
  await refTable(cardF, cols, rows, { footer: o.footer });
  return { sh, cardF, bar, missing };
}

if (PART === 3) {
  // ---- BS-08 通知鈴、通知清單、通知提示(總覽頁)----
  {
    const sh = await refShell("Admin 總覽", "BS-08 通知鈴、通知清單、通知提示");
    const ab = sh.s.findOne(
      (n) => n.type === "INSTANCE" && /AdminAppBar/.test(n.name),
    );
    const org = ab.findOne((n) => n.type === "TEXT" && n.name === "label");
    const bell = await dvar("Draft/NotificationBell", "Unread=True");
    bell.name = "notification-bell(待 AppBar 加槽)";
    sh.main.appendChild(bell);
    bell.layoutPositioning = "ABSOLUTE";
    const ox =
      org.absoluteBoundingBox.x - sh.s.absoluteBoundingBox.x - sh.main.x;
    bell.x = Math.round(ox - bell.width - 24);
    bell.y = Math.round((64 - bell.height) / 2);
    const one = async (n) => {
      const c = await dcomp(n);
      return c.type === "COMPONENT_SET"
        ? c.defaultVariant.createInstance()
        : c.createInstance();
    };
    const panel = await one("Draft/NotificationPanel");
    sh.main.appendChild(panel);
    panel.layoutPositioning = "ABSOLUTE";
    panel.x = Math.round(bell.x + bell.width - panel.width);
    panel.y = 60;
    const toast = await one("Draft/NotificationToast");
    sh.main.appendChild(toast);
    toast.layoutPositioning = "ABSOLUTE";
    toast.x = sh.main.width - toast.width - 24;
    toast.y = sh.s.height - toast.height - 24;
    await refNote(
      sh,
      "AppBar 加通知鈴(未讀數),點開通知清單;新通知在右下角提示。現有 AppBar 還沒有鈴的槽,先疊在上面,搬回底座時 AppBar 加 Notifications 屬性。",
    );
    fin(sh);
  }
  // ---- BS-09 通知設定頁 + 編輯收件人 ----
  {
    const lnk = (l) => inst("Link", { State: "Default" }, { Label: l });
    const grey = (l) => tag(l, "Grey");
    const { sh, missing } = await listPage(
      "BS-09a 通知設定(system.notification-settings)",
      "通知設定",
      [
        ["通知類型", 200],
        ["預設管道", 150],
        ["組織範圍", 220],
        ["收件人", 380],
        ["", 90],
      ],
      [
        [
          "示範表單到期提醒",
          [await grey("站內"), await grey("Email")],
          "單據所屬組織",
          "角色 主管",
          await lnk("編輯"),
        ],
        [
          "印表機離線",
          [await grey("站內")],
          "印表機所在組織含上層",
          "角色 主管 且 持有「印表機管理 · 編輯」",
          await lnk("編輯"),
        ],
        [
          "Email 寄送失敗",
          [await grey("站內")],
          "最上層組織",
          "持有「通知設定 · 編輯」",
          await lnk("編輯"),
        ],
      ],
      { search: "搜尋通知類型", footer: "共 3 筆" },
    );
    const intro = await T(
      "這些提醒的收件人可以依角色、組織與權限調整。待你審核、申請結果這類通知會直接送給當事人,不在這裡設定。",
      "Body/2",
      "text/secondary",
    );
    sh.content.insertChild(0, intro);
    intro.layoutSizingHorizontal = "FILL";
    intro.textAutoResize = "HEIGHT";
    await refNote(
      sh,
      "新頁(系統管理 → 通知設定,圖示 notifications),版型沿用示範模組列表。實際的提醒類型由底座與各專案登記,這裡是示範資料。" +
        (missing.length
          ? "側欄「" + missing.join("、") + "」待底座側欄元件加槽後顯示。"
          : ""),
    );
    fin(sh);
    const ov = await refOverlay(sh, "BS-09b Overlay / 編輯收件人", 860);
    await ov.body(
      "編輯收件人:印表機離線",
      [
        await alert(
          "組織範圍:印表機所在組織含上層(由通知類型決定,不能修改)。收件人 = 組織範圍內、而且符合下列條件的人。",
          "Info",
        ),
        await dvar(
          "Draft/AudiencePicker",
          "AllowEveryone=False, Value=Conditions",
        ),
      ],
      [await btn("取消", "Text"), await btn("儲存")],
    );
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    await noteOut(
      ov.s,
      "本輪改動:收件人用人員條件(AudiencePicker),一定要設條件,沒有「所有人」。",
    );
    fin(ov);
  }
  // ---- BS-12 表單設計器:版面區塊收合設定 / BS-21 允許存草稿 ----
  const designer = async (name) => {
    const sh = await refShell("Admin 表單管理 — 表單設計(畫稿隱藏側欄)", name);
    return {
      sh,
      panel: q(sh.s, "FieldPropertyPanel"),
      detail: q(sh.s, "FormDetailPanel"),
    };
  };
  {
    const { sh, panel } = await designer("BS-12 表單設計器 版面區塊收合設定");
    q(sh.s, "section-header").fills = [await paint("action/selected")];
    const keepHead = q(panel, "header");
    for (const c of [...panel.children]) if (c !== keepHead) c.remove();
    const ht = keepHead.findOne((n) => n.type === "TEXT");
    // 現有設計器把版面區塊叫「分區」(+ 新增分區、刪除分區),沿用同一個詞
    await txt(keepHead, ht.characters, "分區設定 — 基本資料");
    const btnH = keepHead.findChild((n) => n.type === "INSTANCE");
    if (btnH) btnH.remove();
    add(panel, await sw("可以收合", true));
    add(panel, await sw("預設收合", false));
    add(panel, await T("收合時標題列顯示的欄位", "Body/2", "text/secondary"));
    await put(
      add(
        panel,
        H(6, {
          name: "summary-fields",
          layoutWrap: "WRAP",
          counterAxisSpacing: 6,
        }),
        "FILL",
      ),
      [
        await orgChip("假別"),
        await orgChip("天數"),
        await btn("+ 欄位", "Text", "Primary", "Default", "Small"),
      ],
    );
    await noteOut(
      sh.s,
      "使用者展開 / 收合後的狀態存在這台瀏覽器,只記與預設不同的;表單有錯時自動展開並捲到第一個錯誤。",
    );
    await refNote(
      sh,
      "點版面上的分區標題,右側面板改成分區設定:可以收合、預設收合、收合時標題列顯示的欄位(底座規格 10.3)。",
    );
    fin(sh);
  }
  {
    const { sh, detail } = await designer(
      "BS-21 表單設計器 表單設定:允許存草稿",
    );
    const en = q(detail, "enable");
    const dr = en.clone();
    detail.insertChild(detail.children.indexOf(en) + 1, dr);
    dr.name = "allow-draft";
    await txt(
      dr,
      dr.findOne((n) => n.type === "TEXT").characters,
      "允許存草稿",
    );
    const hint = await T(
      "關掉後,新增 / 編輯頁不顯示 [存草稿],只能直接送出。",
      "Caption",
      "text/secondary",
    );
    detail.insertChild(detail.children.indexOf(dr) + 1, hint);
    await refNote(
      sh,
      "表單設定多一個「允許存草稿」開關(預設開,底座規格 10.10)。",
    );
    fin(sh);
  }
  // ---- BS-13 欄位管理:選項顏色(色票)----
  {
    const sh = await refShell(
      "Admin 欄位管理 — 自訂類別(可編輯 / 停用)",
      "BS-13 欄位管理 選項顏色(色票)",
    );
    const opts = q(sh.s, "Options");
    const rows = opts.children
      .slice(1)
      .filter((n) => n.type === "FRAME" && n.layoutMode === "HORIZONTAL");
    const colors = ["綠", "黃", "紅", null];
    for (const [i, r] of rows.entries()) {
      const last = r.children[r.children.length - 1];
      last.resize(70, last.height);
      if (i === 0) {
        const c = r.children[1].clone();
        r.insertChild(1, c);
        await setProps(c, { Label: "顏色" });
        c.resize(74, c.height);
      } else {
        const w = r.children.find((n) => n.type === "FRAME").clone();
        clear(w);
        r.insertChild(1, w);
        w.resize(74, w.height);
        const col = colors[i - 1];
        if (col) add(w, await palChip(col));
        else add(w, await T("不設定", "Body/2", "text/secondary"));
      }
    }
    const pop = V(10, {
      name: "palette-popover",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
    });
    pop.fills = [await paint("bg/paper")];
    pop.effectStyleId = (await sty("Shadow/Dialog")).id;
    await rad(pop, "radius/sm");
    add(pop, await T("選擇顏色", "Subtitle/2"));
    const g = add(pop, V(8));
    for (let i = 0; i < 10; i += 5) {
      const r = add(g, H(8));
      for (const p of PAL.slice(i, i + 5)) add(r, await palChip(p[0]));
    }
    add(pop, await btn("不設定", "Text", "Primary", "Default", "Small"));
    sh.s.appendChild(pop);
    if (sh.s.layoutMode !== "NONE") pop.layoutPositioning = "ABSOLUTE";
    const anchor = rows[2].children[1];
    pop.x = Math.round(
      anchor.absoluteBoundingBox.x - sh.s.absoluteBoundingBox.x,
    );
    pop.y = Math.round(
      anchor.absoluteBoundingBox.y - sh.s.absoluteBoundingBox.y + 36,
    );
    await noteOut(
      sh.s,
      "色票 10 組,每組有淺色 / 深色模式的底色與文字色;只能從色票選,不能輸入色碼。草稿暫用色碼,搬回底座時新增 tagPalettes 變數。",
    );
    await refNote(sh, "選項表格加「顏色」欄(選填,色票代號);點顏色開色票選單。");
    fin(sh);
  }
}

// 印表機管理(新頁):版型沿用申請中心的卡片(頁內分頁 + 右上按鈕 + 篩選 + 表格 + 頁碼)
async function printerPage(name, tab, btnLabel) {
  const sh = await refShell("Admin 申請中心 — 我的申請", name);
  await pageTitle(sh, "印表機管理");
  const missing = await sysNav(sh);
  await navActive(sh, "印表機管理");
  const cardF = q(sh.s, "ApplyCenterCard");
  await cardTabs(q(cardF, "tabs"), ["印表機", "代理程式", "列印紀錄"], tab);
  const top = q(cardF, "top").findChild(
    (n) => n.type === "INSTANCE" && /Button/.test(n.name),
  );
  if (btnLabel) await setProps(top, { Label: btnLabel });
  else top.remove();
  return {
    sh,
    cardF,
    filters: q(cardF, "ApplyCenterFilters"),
    dt: q(cardF, "DataTable"),
    missing,
  };
}
const navNote = (m) =>
  m.length ? "側欄「" + m.join("、") + "」待底座側欄元件加槽後顯示。" : "";

if (PART === 4) {
  const lnk = (l) => inst("Link", { State: "Default" }, { Label: l });
  // ---- BS-10a 印表機分頁 ----
  const pr = await printerPage(
    "BS-10a 印表機管理(system.printers):印表機分頁",
    "印表機",
    "+ 新增印表機",
  );
  {
    const fs = pr.filters.children.filter((n) => n.type === "INSTANCE");
    await setField(fs[0], "所屬組織", "全部");
    await setField(fs[1], "狀態", "全部");
    fs[2].remove();
    await refTable(
      pr.dt,
      [
        ["名稱", 170],
        ["所屬組織", 150],
        ["IP:Port", 170],
        ["代理程式", 150],
        ["預設", 70],
        ["狀態", 100],
        ["", 228],
      ],
      [
        [
          "櫃台收據機",
          "示範分店 A",
          "192.168.1.50:9100",
          "櫃台電腦",
          await tag("預設", "Primary"),
          await tag("正常", "Success"),
          [await lnk("測試列印"), await lnk("編輯")],
        ],
        [
          "倉庫收據機",
          "示範分店 B",
          "192.168.2.20:9100",
          "倉庫電腦",
          "",
          await tag("離線", "Grey"),
          [await lnk("測試列印"), await lnk("編輯")],
        ],
      ],
      { footer: "共 2 筆" },
    );
    await refNote(
      pr.sh,
      "新頁(系統管理 → 印表機管理,圖示 print),版型沿用申請中心的卡片;頁內分頁:印表機 | 代理程式 | 列印紀錄。" +
        navNote(pr.missing),
    );
    fin(pr.sh);
  }
  // ---- BS-17 新增 / 編輯印表機 ----
  {
    const ov = await refOverlay(
      pr.sh,
      "BS-17 Overlay / 印表機管理:新增 / 編輯印表機(IP、port、分店預設)",
      480,
    );
    const org = await dvar("Draft/OrgTreeSelect", "State=Closed, Mode=Single");
    await setText(org, "組織", "所屬組織");
    await setText(org, "A 店", "示範分店 A");
    const ipr = H(12, { name: "ip-port" });
    await put(ipr, [
      await field("IP 位址", "192.168.1.50"),
      await field("Port", "9100"),
    ]);
    await ov.body(
      "新增印表機",
      [
        org,
        await field("名稱", "櫃台收據機"),
        ipr,
        await select("代理程式", "櫃台電腦 · 已連線"),
        await select("紙寬", "58mm"),
        await check("設為這個組織的預設印表機", true),
        await sw("啟用", true),
        await T(
          "建議在路由器保留 IP(把收據機 MAC 綁定固定 IP)。",
          "Caption",
          "text/secondary",
        ),
      ],
      [await btn("取消", "Text"), await btn("儲存")],
    );
    for (const n of ipr.children) n.layoutSizingHorizontal = "FILL";
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    await noteOut(
      ov.s,
      "本輪改動:新頁的新增 / 編輯對話框;設定步驟收據機到貨後補上。",
    );
    fin(ov);
  }
  // ---- BS-18a/b/c 測試列印結果 ----
  for (const [sev, msg, k, lab] of [
    ["Success", "已印出:中文、QR code、切紙都正常。", "a", "成功"],
    ["Warning", "失敗:缺紙。補紙後再按一次 [測試列印]。", "b", "缺紙"],
    ["Error", "失敗:代理程式離線(最後連線 10/16 21:40)。", "c", "離線"],
  ]) {
    const ov = await refOverlay(
      pr.sh,
      `BS-18${k} Overlay / 印表機管理:測試列印結果(${lab})`,
      420,
    );
    await ov.body(
      "測試列印 · 櫃台收據機",
      [await alert(msg, sev)],
      [await btn(sev === "Success" ? "關閉" : "重試")],
    );
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    fin(ov);
  }
  // ---- BS-19 代理程式分頁:下載區 + 代理程式清單 ----
  const ag = await printerPage(
    "BS-19 印表機管理:代理程式分頁下載區(最新版本、四個平台、反白建議)",
    "代理程式",
    "+ 新增代理程式",
  );
  {
    const dl = V(10, {
      name: "download",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
    });
    dl.fills = [await paint("bg/default")];
    await rad(dl, "radius/sm");
    add(dl, await T("列印代理程式 · 最新版本 1.2.0", "Subtitle/2"));
    add(
      dl,
      await T(
        "裝在店內每天開著的電腦上(可以和收銀共用同一台);一家店只需要一個。電腦和收據機要在同一個區域網路,並關閉睡眠。",
        "Body/2",
        "text/secondary",
      ),
      "FILL",
    ).textAutoResize = "HEIGHT";
    const b = add(dl, H(8, { name: "downloads" }));
    for (const [p, sug] of [
      ["Windows x64(建議)", true],
      ["Linux x64", false],
      ["Linux arm64", false],
      ["macOS arm64", false],
    ])
      add(
        b,
        await btn(
          "下載 " + p,
          sug ? "Contained" : "Outlined",
          "Primary",
          "Default",
          "Small",
        ),
      );
    ag.cardF.insertChild(ag.cardF.children.indexOf(ag.filters), dl);
    dl.layoutSizingHorizontal = "FILL";
    ag.filters.remove();
    await refTable(
      ag.dt,
      [
        ["代理程式", 200],
        ["所屬組織", 160],
        ["狀態", 100],
        ["最後連線", 160],
        ["版本", 160],
        ["", 260],
      ],
      [
        [
          "櫃台電腦",
          "示範分店 A",
          await tag("已連線", "Success"),
          "10/16 22:01",
          "1.2.0",
          [await lnk("重新配對"), await lnk("停用")],
        ],
        [
          "倉庫電腦",
          "示範分店 B",
          await tag("離線", "Grey"),
          "10/12 18:30",
          [await T("1.1.0"), await tag("請更新", "Warning")],
          [await lnk("重新配對"), await lnk("停用")],
        ],
      ],
      { footer: "共 2 筆" },
    );
    await noteOut(
      ag.sh.s,
      "依瀏覽器偵測的系統反白建議的那個;按下時產生 1 小時有效的簽名網址。更新時再安裝一次,會保留金鑰。",
    );
    await refNote(
      ag.sh,
      "代理程式分頁:下載區(最新版本、四個平台)+ 代理程式清單。" +
        navNote(ag.missing),
    );
    fin(ag.sh);
  }
  // ---- BS-10b 新增代理程式(配對碼)----
  {
    const ov = await refOverlay(
      ag.sh,
      "BS-10b Overlay / 新增代理程式(配對碼)",
      560,
    );
    const box = V(8, {
      name: "pairing",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
    });
    box.fills = [await paint("bg/default")];
    await rad(box, "radius/sm");
    for (const [l, v, st] of [
      ["伺服器網址", "https://api.example.com", "Body/2"],
      ["配對碼", "8K3M-Q7PZ", "Heading/H6"],
    ]) {
      const r = add(box, H(8, { name: l }), "FILL");
      add(r, await T(l, "Caption", "text/secondary"));
      add(r, await T(v, st));
      spacer(r);
      add(r, await btn("複製", "Text", "Primary", "Default", "Small"));
    }
    add(
      box,
      await T(
        "10 分鐘內有效。在店內電腦執行安裝程式,貼上伺服器網址與配對碼即可完成。",
        "Caption",
        "text/secondary",
      ),
      "FILL",
    ).textAutoResize = "HEIGHT";
    await ov.body(
      "新增代理程式",
      [
        await select("所屬組織", "示範分店 A"),
        await field("名稱", "示範分店 A 櫃台電腦"),
        box,
      ],
      [await btn("完成")],
    );
    ov.center();
    await noteOut(ov.s, "對應現有畫面:" + ov.src);
    fin(ov);
  }
  // ---- BS-20 列印紀錄分頁 ----
  {
    const lg = await printerPage(
      "BS-20 印表機管理:列印紀錄分頁",
      "列印紀錄",
      null,
    );
    const fs = lg.filters.children.filter((n) => n.type === "INSTANCE");
    await setField(fs[0], "印表機", "全部");
    await setField(fs[1], "結果", "全部");
    await setField(fs[2], "期間", "10/10 ~ 10/16");
    await refTable(
      lg.dt,
      [
        ["時間", 140],
        ["單據", 220],
        ["印表機", 160],
        ["次數", 120],
        ["結果", 160],
        ["操作者", 140],
        ["", 100],
      ],
      [
        [
          "10/16 22:02",
          "示範單據 #D-0031",
          "櫃台收據機",
          "第 1 次",
          await tag("已印出", "Success"),
          "示範使用者",
          "",
        ],
        [
          "10/16 21:58",
          "示範單據 #D-0030",
          "櫃台收據機",
          "補印 第 2 次",
          await tag("已印出", "Success"),
          "示範使用者",
          "",
        ],
        [
          "10/16 21:40",
          "示範單據 #D-0029",
          "倉庫收據機",
          "第 1 次",
          await tag("失敗:離線", "Error"),
          "示範使用者",
          await lnk("重印"),
        ],
      ],
      { footer: "共 3 筆" },
    );
    await refNote(
      lg.sh,
      "列印紀錄分頁:每次列印與補印都記一筆;失敗的可以重印。" +
        navNote(lg.missing),
    );
    fin(lg.sh);
  }
}

// 現有元件的實例(從現有畫面或草稿元件裡找一個實例,取它的主元件)
async function mainOf(root, re) {
  for (const i of root.findAllWithCriteria({ types: ["INSTANCE"] })) {
    const mc = await i.getMainComponentAsync();
    if (!mc) continue;
    const o = mc.parent && mc.parent.type === "COMPONENT_SET" ? mc.parent : mc;
    if (re.test(o.name)) return o;
  }
  throw new Error("找不到實例 " + re);
}
async function iconBtn(key) {
  const set = await mainOf(await dcomp("Draft/Section"), /IconButton/);
  const b = (
    set.type === "COMPONENT_SET" ? set.defaultVariant : set
  ).createInstance();
  const icons = await dcomp("Draft/ActionIcon+");
  const g = icons.children.find((c) => c.name === "key=" + key);
  const pk = Object.keys(b.componentProperties).find((x) =>
    x.startsWith("Icon"),
  );
  if (g && pk) b.setProperties({ [pk]: g.id });
  return b;
}
// 一張示範卡(元件各狀態;不是畫面)
async function sheet(name, w) {
  const b = await card(name, 16, 24);
  figma.currentPage.appendChild(b);
  b.resize(w, b.height);
  return b;
}

if (PART === 5) {
  // ---- BS-11 列印按鈕各狀態、58mm 版面零件 ----
  {
    const b = await sheet("BS-11 列印按鈕各狀態、58mm 版面零件示範", 1200);
    add(b, await T("列印按鈕", "Heading/H6"));
    const r = add(b, H(16, { name: "states" }));
    for (const st of [
      "Default",
      "Sending",
      "Printed",
      "Failed",
      "Reprint",
      "Disabled",
    ])
      add(r, await dinst("PrintButton", { State: st }));
    add(b, await T("58mm 單據(用版面零件組成)", "Heading/H6"));
    const rr = add(
      b,
      H(24, { name: "receipts", counterAxisAlignItems: "MIN" }),
    );
    add(rr, (await node("Receipt58")).createInstance());
    const legend = add(rr, V(8, { name: "parts" }));
    for (const s of [
      "Receipt58Header:組織 / 標題 / 單號 / 時間 / 補印",
      "Receipt58Row:標籤:值",
      "Receipt58TableRow:表頭 / 內容,最多 3 欄",
      "Receipt58Range:號碼區段",
      "Receipt58Total:合計",
      "Receipt58Divider:虛線",
      "Receipt58QR:單據在後台的連結",
      "Receipt58Signature:簽名欄",
    ])
      add(legend, await T(s));
    await noteOut(
      b,
      "元件示範卡(不是畫面)。按鈕用現有 Button 組成;58mm 單據只用黑白(熱感紙)。",
    );
    fin(b);
  }
  // ---- BS-14 側欄計數:現有側欄(展開 / 收合)加數字 ----
  {
    const b = await sheet("BS-14 側欄計數(登記制)", 640);
    add(
      b,
      await T("側欄計數:各模組登記自己的數字,透過信號即時更新", "Subtitle/1"),
    );
    const row = add(b, H(32, { name: "navs", counterAxisAlignItems: "MIN" }));
    const ex = (await refFrame("Admin 申請中心 — 我的申請"))
      .findOne(
        (n) => n.type === "INSTANCE" && /^Draft\/AdminSideNav$/.test(n.name),
      )
      .clone();
    add(row, ex);
    await rebase(ex);
    await sysNav({ s: b }); // 系統管理群組:現有 8 項 → 通知設定 → 印表機管理
    for (const it of ex.findAll(
      (n) =>
        n.type === "INSTANCE" && /NavItem|^spare-/.test(n.name) && n.visible,
    )) {
      const l = it.findOne((t) => t.type === "TEXT" && t.name === "label");
      if (l && ["表單管理", "示範表單(頂層)"].includes(l.characters))
        await setProps(it, { Badge: true });
    }
    const col = (await refFrame("Admin 流程管理 — 流程設計(側欄收合)"))
      .findOne(
        (n) => n.type === "INSTANCE" && /AdminSideNavCollapse/.test(n.name),
      )
      .clone();
    add(row, col);
    await rebase(col);
    for (const n of row.children) {
      n.layoutSizingVertical = "FIXED";
      n.resize(n.width, 820);
    }
    await noteOut(
      b,
      "以現有側欄(展開 / 收合)為底,只多數字。例:申請中心「待我處理」、各模組自己登記的數字;收合時圖示列顯示小圓點。數字由 API 一次回傳使用者看得到的模組。",
    );
    fin(b);
  }
  // ---- BS-15 頁內分頁 PageTabs:網址參數 + 放不下時橫向捲動 ----
  {
    const sh = await refShell(
      "Admin 申請中心 — 我的申請",
      "BS-15a 頁內分頁 PageTabs + 網址參數",
    );
    const url = H(8, {
      name: "browser-url",
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 6,
    });
    url.fills = [await paint("bg/paper")];
    url.strokes = [await paint("divider")];
    await rad(url, "radius/sm");
    add(
      url,
      await T(
        '/apply-center?tab=mine&list={"form":"leave","status":"reviewing","page":1}',
        "Body/2",
        "text/secondary",
      ),
    );
    sh.content.insertChild(0, url);
    url.layoutSizingHorizontal = "FILL";
    await noteOut(
      sh.s,
      "瀏覽器網址列示意(不是畫面元件):分頁、篩選、頁碼存在網址(useUrlState,一個 key 一包 JSON);重新整理或分享網址後狀態相同。只有一個分頁時不顯示分頁籤;沒有權限的分頁不顯示。",
    );
    await refNote(
      sh,
      "現有申請中心的頁內分頁與篩選改存在網址(useUrlState);畫面不變。",
    );
    fin(sh);
    // 放不下時:單列橫向捲動,有更多分頁的那一側固定顯示漸層 + ‹ › 按鈕
    const b = await sheet(
      "BS-15b PageTabs 放不下時:橫向捲動 + 漸層與箭頭",
      520,
    );
    const labels = [
      "基本資料",
      "聯絡資訊",
      "合約",
      "附件",
      "審核紀錄",
      "修訂紀錄",
      "系統資訊",
    ];
    const strip = async (title, offset, left, right) => {
      add(b, await T(title, "Body/2", "text/secondary"));
      const vp = figma.createFrame();
      vp.name = "PageTabs(可捲動)";
      vp.resize(472, 41);
      vp.fills = [];
      vp.clipsContent = true;
      add(b, vp);
      const tabs = H(16, { name: "tabs" });
      vp.appendChild(tabs);
      for (const [i, l] of labels.entries())
        add(
          tabs,
          await inst(
            "Tab",
            { State: i === (offset ? 4 : 1) ? "Active" : "Default" },
            { Label: l, Badge: false },
          ),
        );
      tabs.x = left ? -120 * offset : 0;
      tabs.y = 0;
      const fade = async (side) => {
        const g = figma.createRectangle();
        g.name = side === "right" ? "scroll-edge:end" : "scroll-edge:start";
        g.resize(72, 40);
        const w = { r: 1, g: 1, b: 1 };
        g.fills = [
          {
            type: "GRADIENT_LINEAR",
            gradientTransform:
              side === "right"
                ? [
                    [1, 0, 0],
                    [0, 1, 0],
                  ]
                : [
                    [-1, 0, 1],
                    [0, 1, 0],
                  ],
            gradientStops: [
              { position: 0, color: { ...w, a: 0 } },
              { position: 0.6, color: { ...w, a: 1 } },
            ],
          },
        ];
        vp.appendChild(g);
        g.x = side === "right" ? 472 - 72 : 0;
        g.y = 0;
        const ib = await iconBtn(
          side === "right" ? "chevron-right" : "chevron-left",
        );
        vp.appendChild(ib);
        ib.x = side === "right" ? 472 - ib.width : 0;
        ib.y = Math.round((40 - ib.height) / 2);
      };
      if (left) await fade("left");
      if (right) await fade("right");
    };
    await strip("一開始(右邊還有)", 0, false, true);
    await strip("捲到中間(兩邊都有)", 2, true, true);
    await noteOut(
      b,
      "放不下時單列橫向捲動;有更多分頁的那一側固定顯示漸層與 ‹ / › 按鈕(點了捲一段),捲到底那一側消失;選到的分頁(含從網址打開)自動捲進可視範圍。以現有 Draft/Tab 組成,不另做元件。漸層暫用白色,搬回底座時綁 bg/paper。",
    );
    fin(b);
  }
  // ---- BS-16 Stepper 各狀態 ----
  {
    const b = await sheet("BS-16 Stepper 各狀態(寬 / 窄)", 640);
    add(b, await T("寬螢幕", "Subtitle/1"));
    add(b, await stepper(["基本資料", "明細", "附件", "審核人", "確認"], 2));
    add(b, await T("有錯的步驟", "Subtitle/1"));
    add(b, await stepper(["基本資料", "明細", "確認"], 2, 1));
    add(b, await T("窄螢幕", "Subtitle/1"));
    add(b, await dinst("Stepper", { Width: "Narrow" }));
    await noteOut(
      b,
      "元件示範卡(不是畫面)。數字圓點、線、字級沿用現有 Button / Tag 的主色與文字樣式。",
    );
    fin(b);
  }
}
