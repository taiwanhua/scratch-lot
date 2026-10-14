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
  // ST-13 盤點頁:第三輪重畫,見 r3-store.js 段 1。
  // ST-14 差異核對:第三輪重畫,見 r3-store.js 段 2。
  // ST-15 送出確認:第三輪重畫,見 r3-store.js 段 2。
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
