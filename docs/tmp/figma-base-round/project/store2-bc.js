// 「Screen / 店面管理」第二輪 PART B(盤點)、PART C(交班 ④、日結 ①②)。
// 前置:`const PROJECT = true; const PART = "B" | "C";` + ../_kit.js + store2.js 的「店面管理專用」函式 + 本檔。
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("65:14"));
if (PART === "B") {
  const Y = await rowY("第二輪:盤點(ST-13~16)");
  // ST-16 臨時盤點範圍
  {
    const { ov, dlg } = await overlay(
      "ST-16 Overlay / 臨時盤點範圍(全店 / 單一收銀點)",
      460,
    );
    await dhead(dlg, "開始盤點(臨時)");
    add(dlg, await radio("全店", true));
    await put(add(dlg, H(8)), [
      await radio("單一收銀點"),
      await select("", "店內櫃台", 180, "Disabled"),
    ]);
    await cap(
      dlg,
      "同一家店同時只能有一張「盤點中」;盤點期間照常銷售,每本與盤點那一刻的系統數字比對。臨時盤點完成後送「盤點確認申請」。",
    );
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("開始盤點")]),
      "FILL",
    );
    done({ ov }, Y);
  }
  const bookRow = async (name, sub, st, sel) => {
    const r = H(8, {
      name: "book",
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
    });
    if (sel) {
      r.fills = [await paint("action/selected")];
      await rad(r, "radius/sm");
    }
    const c = add(r, V(2));
    add(c, await T(name, "Subtitle/2"));
    add(c, await T(sub, "Caption", "text/secondary"));
    spacer(r);
    for (const s of st) add(r, await tag(s[0], s[1]));
    return r;
  };
  const progress = async (n, total) => {
    const r = H(12, { name: "progress" });
    add(r, await bold(`已盤 ${n} / ${total} 本`));
    const bar = add(r, H(0, { name: "bar" }), "FILL");
    bar.layoutSizingVertical = "FIXED";
    bar.resize(bar.width, 6);
    bar.fills = [await paint("action/disabledBackground")];
    bar.cornerRadius = 3;
    const f = figma.createRectangle();
    f.resize(Math.round((240 * n) / total), 6);
    f.cornerRadius = 3;
    f.fills = [await paint("primary/main")];
    add(bar, f);
    return r;
  };
  // ST-13 盤點頁(寬螢幕)
  {
    const sh = await shell(
      "ST-13 盤點頁(寬螢幕):本清單、方式切換、未拆的本、待查清單",
      "店面管理",
      "店面管理",
      "盤點 S-0032",
    );
    add(
      sh.content,
      await titleRow("臨時盤點 · 全店", "S-0032 · 10/16 21:40 開始 · 王小明", [
        await tag("盤點中", "Warning"),
        await btn("取消盤點", "Text", "Error"),
      ]),
      "FILL",
    );
    add(sh.content, await progress(12, 18), "FILL");
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    const left = add(body, await card("book-list", 4, 12));
    left.resize(400, left.height);
    add(left, await T("店內櫃台", "Subtitle/1", "text/secondary"));
    for (const b of [
      ["5164 發大財", "本號 056527 · 檯面 35 張", [["已盤", "Success"]]],
      [
        "5201 金好運",
        "本號 060112 · 檯面 35 張",
        [
          ["已盤", "Success"],
          ["異常", "Error"],
        ],
      ],
      ["5198 鼠來寶", "本號 088102 · 檯面 6 張", [["未盤", "Grey"]], 1],
      ["5150 好運旺旺", "本號 042210 · 已拆開到兩個收銀點", [["未盤", "Grey"]]],
    ])
      add(left, await bookRow(b[0], b[1], b[2], b[3]), "FILL");
    add(left, await T("店外攤位", "Subtitle/1", "text/secondary"));
    for (const b of [
      ["5164 發大財", "本號 056528 · 檯面 35 張", [["已盤", "Success"]]],
      ["5133 招財貓", "本號 071204 · 檯面 10 張", [["未盤", "Grey"]]],
    ])
      add(left, await bookRow(b[0], b[1], b[2]), "FILL");
    const right = add(body, V(16, { name: "right" }), "FILL");
    const cur = add(right, await card("current-book", 12), "FILL");
    add(
      cur,
      await titleRow("5198 鼠來寶 · 本號 088102", "店內櫃台 · 100 元"),
      "FILL",
    );
    add(cur, await tabs(["數量", "點格子", "掃描"], "數量"), "FILL");
    add(cur, await kv("系統數字(21:52)", "6 張"), "FILL");
    add(cur, await field("實盤數", "5", { w: 200 }));
    add(cur, await kv("推定售出", "1 張 · 100 元", { strong: true }), "FILL");
    await cap(
      cur,
      "被拆開到多個收銀點的本,只能用點格子或掃描。實盤比系統多時只能標記異常。",
    );
    add(
      cur,
      await actions([await btn("下一本")], [await btn("上一本", "Text")]),
      "FILL",
    );
    const un = add(right, await card("unopened", 8), "FILL");
    add(un, await T("未拆的本(在 / 不在)", "Subtitle/1"));
    add(
      un,
      await table(
        [
          ["本", 200],
          ["遊戲", 160],
          ["張數", 70],
          ["在不在", 180],
        ],
        [
          [
            "071205",
            "5133 招財貓",
            "25",
            [await radio("在", true), await radio("不在")],
          ],
          [
            "088103",
            "5198 鼠來寶",
            "100",
            [await radio("在"), await radio("不在", true)],
          ],
        ],
      ),
      "FILL",
    );
    await cap(un, "不在的本:盤點完成時列為待查,責任分店 = 本店。");
    const lost = add(right, await card("lost-review", 8), "FILL");
    add(lost, await T("待查清單", "Subtitle/1"));
    add(
      lost,
      await table(
        [
          ["本", 180],
          ["原因", 200],
          ["處理", 240],
        ],
        [
          [
            "5164 · 056420",
            "10/12 調貨在途刪除",
            await select("", "找到了(刷條碼)", 220),
          ],
          [
            "5201 · 060090",
            "10/05 盤點時不在",
            await select("", "確認遺失(原因必填)", 220),
          ],
        ],
      ),
      "FILL",
    );
    await cap(lost, "確認遺失需要有權限,原因必填;也可以「繼續待查」。");
    add(
      sh.content,
      await actions(
        [await btn("差異核對 →")],
        [await muted("盤點期間照常銷售;待核准的盤點不擋下一次盤點")],
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // ST-14 差異核對
  {
    const sh = await shell(
      "ST-14 盤點頁:差異核對",
      "店面管理",
      "店面管理",
      "盤點 S-0032",
    );
    add(
      sh.content,
      await titleRow("差異核對", "臨時盤點 · 全店 · S-0032", [
        await tag("盤點中", "Warning"),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await alert(
        "撤銷審核中 2 張(#R-008):標示「撤銷審核中」,不算差異。",
        "Info",
      ),
      "FILL",
    );
    const opt = async (on, onlyMark) => {
      const r = H(12);
      for (const [l, i] of [
        ["重新盤點", 0],
        ["視為售出", 1],
        ["標記異常", 2],
      ])
        if (!onlyMark || i === 2) add(r, await radio(l, on === i));
      return r;
    };
    add(
      sh.content,
      await table(
        [
          ["本", 220],
          ["收銀點", 110],
          ["系統", 60],
          ["實盤", 60],
          ["差異", 70],
          ["處理", 360],
        ],
        [
          [
            "5198 鼠來寶 · 088102",
            "店內櫃台",
            "6",
            "5",
            await red("−1"),
            await opt(1),
          ],
          [
            "5201 金好運 · 060112",
            "店內櫃台",
            "35",
            "33",
            await red("−2"),
            await opt(1),
          ],
          [
            "5133 招財貓 · 071204",
            "店外攤位",
            "10",
            "11",
            await warn("+1"),
            await opt(2, true),
          ],
        ],
        { right: [2, 3, 4] },
      ),
      "FILL",
    );
    const sum = add(sh.content, await card("summary", 8), "FILL");
    add(sum, await T("盤點彙總", "Subtitle/1"));
    for (const [l, v] of [
      ["本數", "18 本"],
      ["推定售出", "3 張 · 600 元"],
      ["號碼不明", "2 張"],
      ["新增待查", "1 本(088103)"],
      ["確認遺失", "1 本 · 批購成本 4,600"],
    ])
      add(sum, await kv(l, v), "FILL");
    add(
      sh.content,
      await actions(
        [await btn("送出盤點確認申請")],
        [await btn("返回盤點", "Text")],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "臨時盤點送「盤點確認申請」;交班與日結的盤點跟著結帳確認申請一起核准。",
    );
    done(sh, Y);
  }
  // ST-15 盤點頁(手機寬度)
  {
    const d = await device(
      "ST-15 盤點頁(手機寬度):本清單改成上方的下拉",
      390,
      844,
      "盤點 S-0032",
    );
    add(
      d.content,
      await select("本", "5198 鼠來寶 · 088102(未盤)", null),
      "FILL",
    );
    add(d.content, await progress(12, 18), "FILL");
    const c = add(d.content, await card("current-book", 12, 16), "FILL");
    add(c, await tabs(["數量", "點格子", "掃描"], "數量"), "FILL");
    add(c, await kv("系統數字", "6 張"), "FILL");
    add(c, await field("實盤數", "5"), "FILL");
    add(c, await kv("推定售出", "1 張 · 100 元", { strong: true }), "FILL");
    add(d.content, await btn("下一本"), "FILL");
    add(d.content, await btn("差異核對", "Outlined"), "FILL");
    done(d.s, Y);
  }
}
if (PART === "C") {
  const Y = await rowY("第二輪:交班 ④、日結 ①②(ST-19、ST-21~23)");
  const shiftSteps = ["盤點", "兌獎", "抽屜", "確認"];
  const closeSteps = ["各班結帳", "全店盤點", "小金庫", "存入銀行", "確認"];
  // ST-19 交班 ④ 確認(兩種情況)
  for (const v of ["a", "b"]) {
    const sh = await shell(
      v === "a"
        ? "ST-19a 交班結帳 ④ 確認(有接班人)"
        : "ST-19b 交班結帳 ④ 確認(最後一班沒有接班人)",
      "店面管理",
      "店面管理",
      "交班結帳 · 店內櫃台",
    );
    add(sh.content, await stepper(shiftSteps, 3));
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    const l = add(body, await card("expected", 6), "FILL");
    add(l, await T("應有現金", "Subtitle/1"));
    for (const [k, x] of [
      ["期初零用金", "3,000"],
      ["銷售", "+ 8,400"],
      ["兌獎", "− 1,200"],
      ["投庫", "− 5,000"],
      ["出庫", "0"],
      ["現金更正", "0"],
    ])
      add(l, await kv(k, x), "FILL");
    add(l, await kv("應有", "5,200", { strong: true }), "FILL");
    add(l, await kv("實點", "5,150", { strong: true }), "FILL");
    add(l, await kv("差額", "−50 · 找錯錢", { color: "error/main" }), "FILL");
    const r = add(body, await card("handover", 12), "FILL");
    add(r, await T("交接", "Subtitle/1"));
    if (v === "a") {
      add(r, await field("留給下一班", "3,000"), "FILL");
      add(r, await select("接班人(選填)", "李小華", null), "FILL");
      await cap(
        r,
        "「留給下一班」大於 0 時接班人必填;接班人當面點過零用金後核准這張結帳單。",
      );
    } else {
      add(
        r,
        await field("留給下一班", "3,000", {
          state: "Error",
          helper: "沒有接班人時必須是 0:請先把錢投庫",
        }),
        "FILL",
      );
      add(r, await select("接班人(選填)", "(沒有接班人)", null), "FILL");
      add(
        r,
        await alert("沒有接班人:這張結帳確認申請改由店長審核。", "Info"),
        "FILL",
      );
    }
    add(
      sh.content,
      await actions(
        [
          await btn(
            "送出並列印結帳單",
            "Contained",
            "Primary",
            v === "a" ? "Default" : "Disabled",
          ),
        ],
        [await btn("上一步", "Text")],
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // ST-21 / ST-22 日結 ① 各班結帳(+ 側邊審核)
  for (const v of ["21", "22"]) {
    const sh = await shell(
      v === "21"
        ? "ST-21 日結 ① 各班結帳(全部核准才能下一步)"
        : "ST-22 日結 ① 側邊打開結帳單審核",
      "店面管理",
      "店面管理",
      "日結 · 中山店",
    );
    add(sh.content, await stepper(closeSteps, 0));
    add(
      sh.content,
      await T(
        "涵蓋計算期間 10/14 09:02 ~ 現在(10/14、10/15 沒有日結)",
        "Body/1",
        "text/secondary",
      ),
    );
    add(
      sh.content,
      await table(
        [
          ["收銀點", 100],
          ["交班人", 80],
          ["送出", 60],
          ["應有", 70],
          ["實點", 70],
          ["差額", 60],
          ["審核者", 80],
          ["狀態", 260],
        ],
        [
          [
            "店內櫃台",
            "王小明",
            "14:02",
            "8,200",
            "8,200",
            "0",
            "李小華",
            await tag("已核准", "Success"),
          ],
          [
            "店內櫃台",
            "李小華",
            "22:10",
            "6,500",
            "6,400",
            await red("−100"),
            "你",
            [
              await tag("待審核", "Warning"),
              await btn("審核", "Outlined", "Primary", "Default", "Small"),
            ],
          ],
          [
            "店外攤位",
            "陳美玲",
            "21:55",
            "3,000",
            "3,000",
            "0",
            "你",
            [await tag("已退回", "Error"), await muted("待陳美玲更正")],
          ],
          [
            "彩券機旁",
            "林美麗",
            "20:30",
            "2,100",
            "2,100",
            "0",
            "王小明",
            [await tag("待審核", "Warning"), await muted("等王小明核准")],
          ],
        ],
        { right: [3, 4, 5], selected: v === "22" ? [1] : [] },
      ),
      "FILL",
    );
    add(
      sh.content,
      await alert(
        "還有 3 班沒核准,全部核准後才能下一步。狀態會即時更新。",
        "Warning",
      ),
      "FILL",
    );
    add(
      sh.content,
      await actions(
        [await btn("下一步", "Contained", "Primary", "Disabled")],
        [await btn("取消", "Text")],
      ),
      "FILL",
    );
    done(sh, Y);
    if (v === "22") {
      const d = await drawer(sh, "結帳單 C-0042 · 店內櫃台 · 李小華");
      for (const [k, x] of [
        ["盤點", "沿用 21:40 全店盤點 S-0032"],
        ["期初零用金", "3,000"],
        ["銷售", "+ 6,900"],
        ["兌獎", "− 400"],
        ["投庫", "− 3,000"],
        ["應有", "6,500"],
        ["實點", "6,400"],
      ])
        add(d, await kv(k, x), "FILL");
      add(
        d,
        await kv("差額", "−100 · 找錯錢", { color: "error/main" }),
        "FILL",
      );
      add(d, await kv("留給下一班", "0(最後一班,已投庫)"), "FILL");
      add(d, await field("審核意見", ""), "FILL");
      add(
        d,
        await actions([
          await btn("退回", "Outlined", "Error"),
          await btn("核准"),
        ]),
        "FILL",
      );
    }
  }
  // ST-23 日結 ② 全店盤點
  {
    const sh = await shell(
      "ST-23 日結 ② 全店盤點(現在 / 沿用 / 跳過與原因)",
      "店面管理",
      "店面管理",
      "日結 · 中山店",
    );
    add(sh.content, await stepper(closeSteps, 1));
    const c = add(sh.content, await card("stocktake-choice", 12), "FILL");
    add(c, await radio("現在盤點(開啟盤點頁,盤全店)"));
    add(c, await radio("沿用 30 分鐘內的全店盤點:S-0032(21:40,王小明)", true));
    add(c, await radio("跳過盤點"));
    const sk = add(c, V(8, { name: "skip", paddingLeft: 28 }), "FILL");
    add(sk, await select("跳過原因(必填)", "人力不足", 280, "Disabled"));
    await cap(sk, "需要有跳過盤點的權限;原因必填,報表會標示「未盤點」。");
    add(
      sh.content,
      await actions([await btn("下一步")], [await btn("上一步", "Text")]),
      "FILL",
    );
    done(sh, Y);
  }
}
return { made };
