// 第二輪底座參考畫面(底座規格 13 畫面清單 BS-03~07、BS-11~16)。中性示範資料。
// 前置:`const PROJECT = false; const PART = 1 | 2 | 3 | 4;` + _kit.js(MODE 改成 base 時在 wowgo-base 本檔執行)。畫在草稿頁(DRAFT_PAGE),一次一段。
// PART 4 = 底座規格 13 的 BS-17~20(印表機管理:新增 / 編輯、測試列印結果、代理程式下載區、列印紀錄)。
await toDraftPage();
const Y = await rowY("第二輪底座參考畫面(BS-03~07、BS-11~16)");
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

if (PART === 1) {
  // ---- BS-03 流程設計器:每一關的設定 ----
  {
    const sh = await shell(
      "BS-03 流程設計器 每一關:跳過、自動通過、逾時提醒、知會",
      "流程管理",
      null,
      "請假流程",
    );
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
      "FILL",
    );
    const canvas = add(body, await card("flow-canvas", 16), "FILL", "FILL");
    add(canvas, await T("流程:請假流程(客製)", "Subtitle/1"));
    const chain = add(canvas, H(12, { name: "steps" }));
    for (const [l, sel] of [
      ["申請", 0],
      ["第 1 關 主管審核", 1],
      ["第 2 關 人資審核", 0],
      ["完成", 0],
    ]) {
      const n = H(8, {
        name: "step",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
      });
      n.fills = [await paint("bg/paper")];
      n.strokes = [await paint(sel ? "primary/main" : "divider")];
      n.strokeWeight = sel ? 2 : 1;
      await rad(n, "radius/sm");
      add(n, await T(l, "Subtitle/2"));
      add(chain, n);
      if (l !== "完成")
        add(chain, await T("→", "Subtitle/1", "text/secondary"));
    }
    const panel = add(body, await card("step-settings", 16), null, "HUG");
    panel.resize(460, panel.height);
    add(panel, await T("第 1 關 主管審核", "Heading/H6"));
    add(
      panel,
      await T(
        "審核者:人員條件「角色 主管 且 所屬組織屬於 申請人的組織(本身)」",
        "Body/2",
        "text/secondary",
      ),
      "FILL",
    ).textAutoResize = "HEIGHT";
    const skip = V(8, { name: "B4 指定組織跳過" });
    add(skip, await T("跳過", "Subtitle/1"));
    add(skip, await T("申請人屬於下列組織時,跳過這一關:", "Body/2"));
    await put(add(skip, H(6, { name: "orgs" })), [
      await orgChip("最上層組織"),
      await orgChip("示範分店 A"),
      await btn("+ 選擇組織", "Text", "Primary", "Default", "Small"),
    ]);
    add(skip, await check("包含下層組織"));
    await cap(
      skip,
      "判斷申請人所屬的組織(全部);與既有跳過條件任一成立就跳過;被跳過的關卡不執行 beforeApprove。",
    );
    add(panel, skip, "FILL");
    const auto = V(8, { name: "B5 自動通過" });
    add(auto, await T("自動通過", "Subtitle/1"));
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
    add(panel, auto, "FILL");
    const remind = V(8, { name: "B16 逾時提醒" });
    add(remind, await T("逾時提醒", "Subtitle/1"));
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
    add(remind, await T("通知對象(人員條件):角色 流程管理者  [編輯]"));
    await cap(remind, "只提醒,不自動核准或駁回;同一任務同一級別只通知一次。");
    add(panel, remind, "FILL");
    const cc = V(8, { name: "B17 知會" });
    add(cc, await T("知會", "Subtitle/1"));
    await put(add(cc, H(16)), [
      await radio("通過這一關時", true),
      await radio("流程完成時"),
    ]);
    await put(add(cc, H(8)), [
      await T("對象來源"),
      await select("", "人員條件", 160),
      await btn("編輯對象", "Outlined", "Primary", "Default", "Small"),
    ]);
    await cap(cc, "知會對象不需審核,唯讀看得到這張單據的快照。");
    add(panel, cc, "FILL");
    add(
      panel,
      await actions([await btn("取消", "Text"), await btn("儲存")]),
      "FILL",
    );
    done(sh, Y);
  }
  // ---- BS-04 表單模組綁多張表單的 [+ 新增] 選單 + 發布後提示 ----
  {
    const sh = await shell(
      "BS-04 表單模組 [+ 新增] 選單(依表單權限)",
      "示範表單模組",
      null,
      "示範表單模組",
    );
    const top = add(
      sh.content,
      await titleRow("示範表單模組", "一個模組綁三張表單", [
        await btn("+ 新增 ▾"),
      ]),
      "FILL",
    );
    const menu = V(0, {
      name: "menu(依 create-<formKey> 權限)",
      paddingTop: 6,
      paddingBottom: 6,
    });
    menu.fills = [await paint("bg/paper")];
    menu.effectStyleId = (await sty("Shadow/Dialog")).id;
    await rad(menu, "radius/sm");
    for (const [l, ok2] of [
      ["請假單", 1],
      ["加班單", 1],
      ["出差單(沒有權限,不顯示)", 0],
    ]) {
      const it = H(8, {
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 8,
        paddingBottom: 8,
      });
      add(it, await T(l, "Body/1", ok2 ? "text/primary" : "text/disabled"));
      add(menu, it, "FILL");
    }
    sh.main.appendChild(menu);
    menu.layoutPositioning = "ABSOLUTE";
    menu.resize(260, menu.height);
    add(
      sh.content,
      await table(
        [
          ["單號", 140],
          ["表單", 160],
          ["申請人", 140],
          ["狀態", 120],
          ["建立時間", 200],
        ],
        [
          [
            "F-0012",
            "請假單",
            "王小明",
            await tag("審核中", "Warning"),
            "2026-10-13 09:12",
          ],
          [
            "F-0011",
            "加班單",
            "李小華",
            await tag("已完成", "Success"),
            "2026-10-12 18:40",
          ],
        ],
      ),
      "FILL",
    );
    fit(sh);
    menu.x = sh.main.width - 24 - 260;
    menu.y = top.y + 112 + 44;
    place(sh.s, Y);
    made.push([sh.s.name, sh.s.id]);
    const { ov, dlg } = await overlay(
      "BS-04 Overlay / 表單發布成功:提示授予新增權限",
      520,
    );
    await dhead(dlg, "發布成功");
    add(dlg, await T("「請假單(租戶客製)」第 3 版已發布。", "Body/1"));
    add(
      dlg,
      await alert(
        "已建立權限「請假單 新增」,不會自動授予。請到角色管理授予需要的角色。",
        "Warning",
      ),
      "FILL",
    );
    add(
      dlg,
      await actions([await btn("稍後", "Text"), await btn("前往角色管理")]),
      "FILL",
    );
    done({ ov }, Y);
  }
}

if (PART === 2) {
  // ---- BS-05 個人設定:偏好 ----
  {
    const sh = await shell("BS-05 個人設定 偏好", "個人設定", null, "個人設定");
    add(sh.content, await tabs(["偏好", "代理人"], "偏好"), "FILL");
    const c = add(sh.content, await card("prefs", 16), "FILL");
    add(c, await T("語言", "Subtitle/1"));
    add(c, await select("語言", "繁體中文", 280));
    await cap(
      c,
      "跟著帳號;換電腦登入也一樣。外觀(亮 / 暗)、側欄收合跟著這台瀏覽器,在頭像選單調整。",
    );
    add(c, await T("通知管道", "Subtitle/1"));
    add(
      c,
      await table(
        [
          ["通知類型", 360],
          ["站內通知", 120],
          ["Email", 120],
        ],
        [
          [
            "待你審核",
            await inst("Switch", { State: "On", Enabled: "True" }),
            await inst("Switch", { State: "On", Enabled: "True" }),
          ],
          [
            "單據被退回",
            await inst("Switch", { State: "On", Enabled: "True" }),
            await inst("Switch", { State: "Off", Enabled: "True" }),
          ],
          [
            "審核逾時提醒",
            await inst("Switch", { State: "On", Enabled: "True" }),
            await inst("Switch", { State: "Off", Enabled: "True" }),
          ],
          [
            "知會",
            await inst("Switch", { State: "On", Enabled: "True" }),
            await inst("Switch", { State: "Off", Enabled: "True" }),
          ],
        ],
      ),
      "FILL",
    );
    add(c, await actions([await btn("儲存")]), "FILL");
    done(sh, Y);
  }
  // ---- BS-06 個人設定:代理人 ----
  {
    const sh = await shell(
      "BS-06 個人設定 代理人",
      "個人設定",
      null,
      "個人設定",
    );
    add(sh.content, await tabs(["偏好", "代理人"], "代理人"), "FILL");
    add(
      sh.content,
      await titleRow("代理人", "代理期間內,輪到你審核的任務改派給代理人", [
        await btn("+ 新增代理"),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await alert(
        "代理開始前已派給你的任務不會自動轉移;代理人是申請人時,那張單據仍由你審核。",
        "Info",
      ),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["代理人", 180],
          ["開始", 200],
          ["結束", 200],
          ["備註", 260],
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
            await btn("刪除", "Text", "Error"),
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
      ),
      "FILL",
    );
    done(sh, Y);
    const { ov, dlg } = await overlay("BS-06 Overlay / 新增代理", 480);
    await dhead(dlg, "新增代理");
    add(dlg, await select("代理人", "李小華", null), "FILL");
    await put(add(dlg, H(12), "FILL"), [
      await field("開始", "2026-10-20 00:00"),
      await field("結束", "2026-10-24 23:59"),
    ]);
    for (const n of dlg.children[2].children) n.layoutSizingHorizontal = "FILL";
    add(dlg, await field("備註", "出國"), "FILL");
    await cap(dlg, "代理人必須是本租戶啟用中的使用者。");
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("新增")]),
      "FILL",
    );
    done({ ov }, Y);
  }
  // ---- BS-07 申請中心 批次核准 ----
  {
    const sh = await shell(
      "BS-07 申請中心 待我處理:批次核准",
      "申請中心",
      null,
      "申請中心",
    );
    add(
      sh.content,
      await tabs(["待我處理", "我的申請", "經手紀錄"], "待我處理"),
      "FILL",
    );
    const bar = add(
      sh.content,
      H(12, {
        name: "bulk-bar",
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
      }),
      "FILL",
    );
    bar.fills = [await paint("action/selected")];
    await rad(bar, "radius/sm");
    await put(bar, [
      await bold("已選 3 筆"),
      await muted("只能批次核准;駁回、退回請逐筆處理"),
    ]);
    spacer(bar);
    add(bar, await btn("核准(3)"));
    const cb = (on) =>
      inst("Checkbox", {
        State: on ? "Checked" : "Unchecked",
        Enabled: "True",
      });
    add(
      sh.content,
      await table(
        [
          ["", 40],
          ["單號", 120],
          ["表單", 140],
          ["申請人", 120],
          ["關卡", 160],
          ["送出時間", 180],
        ],
        [
          [
            await cb(1),
            "F-0031",
            "請假單",
            "王小明",
            "第 1 關 主管審核",
            "2026-10-13 09:12",
          ],
          [
            await cb(1),
            "F-0029",
            "加班單",
            "李小華",
            "第 1 關 主管審核",
            "2026-10-12 18:40",
          ],
          [
            await cb(1),
            "F-0027",
            "請假單",
            "陳大文",
            "第 2 關 人資審核",
            "2026-10-12 10:05",
          ],
          [
            await cb(0),
            "F-0026",
            "出差單",
            "林美麗",
            "第 1 關 主管審核",
            "2026-10-11 16:22",
          ],
        ],
        { selected: [0, 1, 2] },
      ),
      "FILL",
    );
    done(sh, Y);
    const { ov, dlg } = await overlay("BS-07 Overlay / 批次核准結果", 520);
    await dhead(dlg, "批次核准");
    add(dlg, await field("共同意見(選填)", "同意"), "FILL");
    add(
      dlg,
      await alert("2 筆已核准,1 筆被擋下(其他筆不受影響)", "Warning"),
      "FILL",
    );
    add(
      dlg,
      await table(
        [
          ["單號", 100],
          ["結果", 300],
        ],
        [
          ["F-0031", await okc("已核准")],
          ["F-0029", await okc("已核准")],
          ["F-0027", await red("被擋下:剩餘假別時數不足")],
        ],
      ),
      "FILL",
    );
    add(dlg, await actions([await btn("關閉")]), "FILL");
    done({ ov }, Y);
  }
}

if (PART === 3) {
  // ---- BS-11 列印按鈕各狀態、58mm 版面零件示範 ----
  {
    const b = await card("BS-11 列印按鈕各狀態、58mm 版面零件示範", 16, 24);
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
      "Receipt58Header:Org / Title / No / Time / Reprint",
      "Receipt58Row:標籤:值",
      "Receipt58TableRow:Head / Body,最多 3 欄",
      "Receipt58Range:號碼區段",
      "Receipt58Total:合計",
      "Receipt58Divider:虛線",
      "Receipt58QR:單據在後台的連結",
      "Receipt58Signature:簽名欄",
    ])
      add(legend, await T(s));
    b.resize(1200, b.height);
    done(b, Y);
  }
  // ---- BS-12 表單設計器:版面區塊收合設定 ----
  {
    const sh = await shell(
      "BS-12 表單設計器 版面區塊收合設定",
      "表單管理",
      null,
      "請假單 設計",
    );
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    const canvas = add(body, await card("layout", 12), "FILL");
    add(
      canvas,
      await section("申請資訊", [
        await grid([await field("假別", "特休"), await field("天數", "2")], 2),
      ]),
    );
    add(
      canvas,
      await section("附件", [], { collapsed: true, summary: "2 個檔案" }),
    );
    for (const s of canvas.children) s.layoutSizingHorizontal = "FILL";
    const panel = add(body, await card("section-settings", 12));
    panel.resize(400, panel.height);
    add(panel, await T("區塊設定:附件", "Subtitle/1"));
    add(panel, await field("區塊標題", "附件"), "FILL");
    add(panel, await sw("可以收合", true));
    add(panel, await sw("預設收合", true));
    add(panel, await T("收合時標題列顯示的欄位", "Body/2", "text/secondary"));
    await put(add(panel, H(6)), [
      await orgChip("檔案數"),
      await btn("+ 欄位", "Text", "Primary", "Default", "Small"),
    ]);
    await cap(
      panel,
      "使用者展開 / 收合後的狀態存在這台瀏覽器,只記與預設不同的;表單有錯時自動展開並捲到第一個錯誤。",
    );
    done(sh, Y);
  }
  // ---- BS-13 欄位管理:選項顏色 ----
  {
    const sh = await shell(
      "BS-13 欄位管理 選項顏色(色票)",
      "欄位管理",
      null,
      "欄位管理",
    );
    add(
      sh.content,
      await titleRow("類別:請假假別", "選項的顏色只能從色票選", [
        await btn("+ 新增選項"),
      ]),
      "FILL",
    );
    // 色票:草稿暫用色碼,重建時新增 tagPalettes 變數(底座規格 10.7)
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
    const chip = async (name) => {
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
    };
    add(
      sh.content,
      await table(
        [
          ["選項", 220],
          ["顏色", 160],
          ["預覽", 200],
          ["狀態", 120],
        ],
        [
          ["特休", "綠", await chip("綠"), await tag("啟用", "Success")],
          ["事假", "黃", await chip("黃"), await tag("啟用", "Success")],
          ["病假", "紅", await chip("紅"), await tag("啟用", "Success")],
          ["其他", "(不設定)", await tag("其他"), await tag("啟用", "Success")],
        ],
      ),
      "FILL",
    );
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
      for (const p of PAL.slice(i, i + 5)) add(r, await chip(p[0]));
    }
    add(pop, await btn("不設定", "Text", "Primary", "Default", "Small"));
    sh.main.appendChild(pop);
    pop.layoutPositioning = "ABSOLUTE";
    pop.x = 24 + 16 + 220 + 12;
    pop.y = 112 + 20 + 48 + 110;
    await cap(
      sh.content,
      "色票 10 組(藍、青、綠、萊姆、黃、橘、紅、粉、紫、灰),每組有淺色 / 深色模式的底色與文字色;不能輸入色碼。Figma 草稿暫用色碼示意,搬回底座時新增色票變數。",
    );
    done(sh, Y);
  }
  // ---- BS-14 側欄計數 ----
  {
    const b = await card("BS-14 側欄計數(登記制)", 16, 24);
    add(
      b,
      await T("側欄計數:各模組登記自己的數字,透過信號即時更新", "Heading/H6"),
    );
    const nav = await inst("AdminSideNav");
    let n = 0;
    for (const it of nav.findAll(
      (x) =>
        x.type === "INSTANCE" &&
        x.componentProperties &&
        Object.keys(x.componentProperties).some((k) => k.startsWith("Badge")),
    )) {
      if (n >= 2) break;
      await setProps(it, { Badge: true });
      n++;
    }
    add(b, nav);
    await cap(
      b,
      "例:申請中心「待我處理 3」、其他模組各自登記(例:示範模組「逾期 2」)。收合時圖示列顯示小圓點。數字由 API 一次回傳使用者看得到的模組。",
    );
    b.resize(560, b.height);
    done(b, Y);
  }
  // ---- BS-15 PageTabs + 網址參數 ----
  {
    const sh = await shell(
      "BS-15 頁內分頁 PageTabs + 網址參數",
      "使用者管理",
      null,
      "使用者管理",
    );
    const url = add(
      sh.content,
      H(8, {
        name: "browser-url",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 6,
        paddingBottom: 6,
      }),
      "FILL",
    );
    url.fills = [await paint("bg/paper")];
    url.strokes = [await paint("divider")];
    await rad(url, "radius/sm");
    add(
      url,
      await T(
        '/system/users?tab=active&list={"q":"王","role":"店長","page":2}',
        "Body/2",
        "text/secondary",
      ),
    );
    add(sh.content, await tabs(["啟用中", "停用"], "啟用中"), "FILL");
    await put(add(sh.content, H(12, { name: "filters" }), "FILL"), [
      await field("關鍵字", "王", { w: 240 }),
      await select("角色", "店長", 200),
      await btn("清除", "Text"),
    ]);
    add(
      sh.content,
      await table(
        [
          ["姓名", 200],
          ["帳號", 240],
          ["角色", 200],
          ["狀態", 120],
        ],
        [
          ["王小明", "wang@example.com", "店長", await tag("啟用", "Success")],
          [
            "王大同",
            "wangdt@example.com",
            "店長",
            await tag("啟用", "Success"),
          ],
        ],
        { footer: "第 2 頁 · 共 2 頁" },
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "分頁、篩選、頁碼存在網址(useUrlState:一個 key 一包 JSON);重新整理或分享網址後狀態相同。只有一個分頁時不顯示分頁籤;沒有權限的分頁不顯示。",
    );
    done(sh, Y);
  }
  // ---- BS-16 Stepper 各狀態 ----
  {
    const b = await card("BS-16 Stepper 各狀態(寬 / 窄)", 16, 24);
    add(b, await T("寬螢幕", "Subtitle/1"));
    add(b, await stepper(["基本資料", "明細", "附件", "審核人", "確認"], 2));
    add(b, await T("有錯的步驟", "Subtitle/1"));
    add(b, await stepper(["基本資料", "明細", "確認"], 2, 1));
    add(b, await T("窄螢幕", "Subtitle/1"));
    add(b, await dinst("Stepper", { Width: "Narrow" }));
    done(b, Y);
  }
}
if (PART === 4) {
  // ---- BS-17~20 印表機管理(第三輪) ----
  const Y4 = await rowY("第三輪:印表機管理(BS-17~20)");
  // 一個遮罩裡並排多個對話框
  const ovRow = (name) => {
    const ov = figma.createFrame();
    ov.name = name;
    ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
    ov.clipsContent = true; // FIGMA-06 Overlay 慣例
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
  };
  const dcard = async (row, title, w) => {
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
    await dhead(d, title);
    return d;
  };
  // 表格欄寬總和超過卡片時等比例縮小
  const fitTables = (root) => {
    for (const r of root.findAll(
      (n) => n.type === "FRAME" && (n.name === "tr" || n.name === "thead"),
    )) {
      const avail =
        r.width -
        r.paddingLeft -
        r.paddingRight -
        r.itemSpacing * (r.children.length - 1);
      const total = r.children.reduce((m, c) => m + c.width, 0);
      if (total <= avail + 1) continue;
      const k = avail / total;
      for (const c of r.children) c.resize(Math.floor(c.width * k), c.height);
    }
  };
  // BS-17 新增 / 編輯印表機
  let o = ovRow(
    "BS-17 Overlay / 印表機管理:新增 / 編輯印表機(IP、port、分店預設)",
  );
  let d = await dcard(o.row, "新增印表機", 480);
  const org = await dinst("OrgTreeSelect", { State: "Closed", Mode: "Single" });
  await setText(org, "組織", "所屬組織");
  await setText(org, "A 店", "示範分店 A");
  add(d, org, "FILL");
  add(d, await field("名稱", "櫃台收據機"), "FILL");
  add(
    d,
    await grid(
      [await field("IP 位址", "192.168.1.50"), await field("Port", "9100")],
      2,
    ),
    "FILL",
  );
  add(d, await select("代理程式", "櫃台電腦 · 已連線"), "FILL");
  add(d, await select("紙寬", "58mm"), "FILL");
  add(d, await check("設為這個組織的預設印表機", true), "FILL");
  add(d, await sw("啟用", true));
  await cap(
    d,
    "建議在路由器保留 IP(把收據機 MAC 綁定固定 IP);設定步驟收據機到貨後補上。",
  );
  add(
    d,
    await actions([await btn("儲存")], [await btn("取消", "Text")]),
    "FILL",
  );
  o.fin();
  done(o.ov, Y4);
  // BS-18 測試列印結果
  o = ovRow("BS-18 Overlay / 印表機管理:測試列印結果(成功 / 缺紙 / 離線)");
  for (const [sev, msg] of [
    ["Success", "✓ 已印出:中文、QR code、切紙都正常。"],
    ["Warning", "✗ 失敗:缺紙。補紙後再按一次 [測試列印]。"],
    ["Error", "✗ 失敗:代理程式離線(最後連線 10/16 21:40)。"],
  ]) {
    d = await dcard(o.row, "測試列印 · 櫃台收據機", 380);
    add(d, await alert(msg, sev), "FILL");
    add(
      d,
      await actions([await btn(sev === "Success" ? "關閉" : "重試")]),
      "FILL",
    );
  }
  o.fin();
  done(o.ov, Y4);
  // BS-19 代理程式分頁下載區
  let sh = await shell(
    "BS-19 印表機管理:代理程式分頁下載區(最新版本、四個平台、反白建議)",
    "印表機管理",
    "印表機管理",
    "印表機管理",
  );
  add(
    sh.content,
    await tabs(["印表機", "代理程式", "列印紀錄"], "代理程式"),
    "FILL",
  );
  const dl = add(sh.content, await card("下載", 12), "FILL");
  const dh = add(dl, H(8), "FILL");
  add(dh, await T("列印代理程式 · 最新版本 1.2.0", "Subtitle/1"));
  spacer(dh);
  add(dh, await btn("+ 新增代理程式(配對碼)", "Outlined"));
  const pr = add(dl, H(12), "FILL");
  for (const [p, sug] of [
    ["Windows x64", true],
    ["Linux x64", false],
    ["Linux arm64", false],
    ["macOS arm64", false],
  ])
    add(pr, await btn("下載 " + p, sug ? "Contained" : "Outlined"));
  await cap(
    dl,
    "依瀏覽器偵測的系統反白建議的那個;按下時產生 1 小時有效的簽名網址。解壓縮後執行安裝,輸入伺服器網址與配對碼。更新時再安裝一次,會保留金鑰。",
  );
  add(
    sh.content,
    await table(
      [
        ["代理程式", 200],
        ["狀態", 100],
        ["最後連線", 160],
        ["版本", 140],
        ["", 220],
      ],
      [
        [
          "櫃台電腦",
          await tag("已連線", "Success"),
          "10/16 22:01",
          "1.2.0",
          [await sbtn("重新配對", "Text"), await sbtn("停用", "Text", "Error")],
        ],
        [
          "倉庫電腦",
          await tag("離線", "Grey"),
          "10/12 18:30",
          [await T("1.1.0"), await tag("請更新", "Warning")],
          [await sbtn("重新配對", "Text"), await sbtn("停用", "Text", "Error")],
        ],
      ],
    ),
    "FILL",
  );
  done(sh, Y4);
  // BS-20 列印紀錄分頁
  sh = await shell(
    "BS-20 印表機管理:列印紀錄分頁",
    "印表機管理",
    "印表機管理",
    "印表機管理",
  );
  add(
    sh.content,
    await tabs(["印表機", "代理程式", "列印紀錄"], "列印紀錄"),
    "FILL",
  );
  add(
    sh.content,
    await filters([
      await select("印表機", "全部", 200),
      await select("結果", "全部", 160),
      await field("期間", "10/10 ~ 10/16", { w: 220 }),
    ]),
    "FILL",
  );
  add(
    sh.content,
    await table(
      [
        ["時間", 120],
        ["單據", 220],
        ["印表機", 160],
        ["次數", 80],
        ["結果", 140],
        ["操作者", 120],
      ],
      [
        [
          "10/16 22:02",
          "示範單據 #D-0031",
          "櫃台收據機",
          "第 1 次",
          await tag("已印出", "Success"),
          "示範使用者",
        ],
        [
          "10/16 21:58",
          "示範單據 #D-0030",
          "櫃台收據機",
          "補印 第 2 次",
          await tag("已印出", "Success"),
          "示範使用者",
        ],
        [
          "10/16 21:40",
          "示範單據 #D-0029",
          "倉庫收據機",
          "第 1 次",
          await tag("失敗:離線", "Error"),
          "示範使用者",
        ],
      ],
    ),
    "FILL",
  );
  done(sh, Y4);
  for (const [, id] of made) fitTables(await figma.getNodeByIdAsync(id));
}
return { made };
