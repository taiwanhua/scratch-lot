// 第二輪:輸出報表(RE)、經銷商管理(DE)、檔案管理(MD)。專案規格 16.5~16.7。
// 前置:`const PROJECT = true; const PART = "RE" | "DE1" | "DE2" | "MD";` + ../_kit.js + seg4.js 的 pageOf / docHead / ovRow / dcard + 本檔。
const PAL = {
  藍: ["#E3F2FD", "#0D47A1"],
  綠: ["#E8F5E9", "#1B5E20"],
  黃: ["#FFF8E1", "#7A5B00"],
  紅: ["#FFEBEE", "#B71C1C"],
  紫: ["#F3E5F5", "#4A148C"],
  橘: ["#FFF3E0", "#9A3B00"],
  青: ["#E0F7FA", "#006064"],
  萊姆: ["#F1F8E9", "#33691E"],
  粉: ["#FCE4EC", "#880E4F"],
  灰: ["#F5F5F5", "#424242"],
};
const hex = (h) => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});
// 色票標籤(底座 tagPalettes 草稿示意,暫用色碼)
async function chip(name, label) {
  const p = PAL[name];
  const c = H(0, {
    name: "tag:" + name,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
  });
  c.fills = [{ type: "SOLID", color: hex(p[0]) }];
  c.cornerRadius = 4;
  const t = await T(label || name, "Caption/SemiBold");
  t.fills = [{ type: "SOLID", color: hex(p[1]) }];
  add(c, t);
  return c;
}
async function chips(list) {
  const r = H(8, { name: "quick-filters" });
  for (const [l, on] of list)
    add(
      r,
      await btn(
        l,
        on ? "Contained" : "Outlined",
        "Primary",
        "Default",
        "Small",
      ),
    );
  return r;
}

if (PART === "RE") {
  await pageOf("Screen / 輸出報表");
  const Y = await rowY("輸出報表(RE-01~02)");
  {
    const sh = await shell(
      "RE-01 輸出報表:選報表 → 條件(期間選擇器、對齊日結)",
      "輸出報表",
      "輸出報表",
      "輸出報表",
    );
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    const l = add(body, await card("report-list", 8));
    l.resize(300, l.height);
    add(l, await T("報表", "Subtitle/1"));
    add(l, await radio("營運報表(分店最多 50 家)", true));
    add(l, await radio("班次結帳歷史報表(分店最多 20 家)"));
    const r = add(body, await card("conditions", 14), "FILL");
    add(r, await T("營運報表 · 條件", "Subtitle/1"));
    add(r, await tabs(["日", "週", "月"], "日"), "FILL");
    await put(add(r, H(8, { counterAxisAlignItems: "MAX" })), [
      await field("日期", "2026-10-16", { w: 200 }),
      await btn("今天", "Outlined", "Primary", "Default", "Small"),
      await btn("昨天", "Outlined", "Primary", "Default", "Small"),
    ]);
    add(r, await check("對齊日結(每家店用「上一次日結 ~ 當天日結」)", true));
    add(
      r,
      await alert(
        "不要把多天的日報相加當成週報;要看一週請選「週」。",
        "Warning",
      ),
      "FILL",
    );
    add(r, await T("分店", "Body/2", "text/secondary"));
    add(
      r,
      (await node("OrgTreeSelect")).children
        .find((v) => v.name.includes("Closed") && v.name.includes("Multiple"))
        .createInstance(),
      "FILL",
    );
    add(
      r,
      await table(
        [
          ["分店", 120],
          ["實際期間", 280],
          ["註記", 360],
        ],
        [
          ["中山店", "10/15 22:05 ~ 10/16 22:30", ""],
          [
            "新竹店",
            "10/16 00:00 ~ 10/17 00:00",
            await warn("本店 10/16 未日結,期間改用整天,小金庫和盤點未核對"),
          ],
        ],
      ),
      "FILL",
    );
    add(
      r,
      await actions([await btn("預覽", "Outlined"), await btn("匯出 Excel")]),
      "FILL",
    );
    await cap(
      r,
      "週:點任一天選整週,顯示「10/11(日)~ 10/17(六)」,星期日起算;月:年月格子,表頭顯示已關帳 / 尚未關帳。沒有自訂區間。條件存在網址。",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "RE-02 輸出報表:預覽(合計工作表、切換分店)",
      "輸出報表",
      "輸出報表",
      "輸出報表",
    );
    add(
      sh.content,
      await titleRow("營運報表 · 2026-10-16(日,對齊日結)", "中山店、新竹店", [
        await btn("匯出 Excel"),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await tabs(["全部分店合計", "中山店", "新竹店"], "全部分店合計"),
      "FILL",
    );
    add(
      sh.content,
      await alert(
        "新竹店 10/16 未日結,期間改用整天,小金庫和盤點未核對。",
        "Warning",
      ),
      "FILL",
    );
    const g = add(
      sh.content,
      H(16, { name: "sections", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    const colA = add(g, V(16), "FILL"),
      colB = add(g, V(16), "FILL");
    const sec = async (col, title, rows) => {
      const c = add(col, await card(title, 6), "FILL");
      add(c, await T(title, "Subtitle/1"));
      for (const [k, v, o] of rows) add(c, await kv(k, v, o || {}), "FILL");
    };
    await sec(colA, "1 銷售", [
      ["刷條碼售出", "412 張 · 84,200"],
      ["手動標記 / 盤點補登", "3 張 · 600"],
      ["撤銷", "− 2 張 · 400"],
      ["淨銷售", "413 張 · 84,400", { strong: true }],
    ]);
    await sec(colA, "2 毛利", [
      ["已售成本", "77,648"],
      ["毛利", "6,752", { strong: true }],
    ]);
    await sec(colA, "3 兌獎", [
      ["兌獎", "38 張 · 9,600(店內持有 1,600 · 已送兌 8,000)"],
    ]);
    await sec(colA, "4 庫存異動", [
      ["進貨", "3 本 · 300 張 · 55,200"],
      ["調入 / 調出", "0 / 10 張 · 1,840"],
      ["調貨損益", "+ 0"],
      ["跳號 / 報廢 / 遺失 / 尋回", "1 / 5 / 1 本 / 0"],
      ["期末庫存", "2,140 張 · 401,200"],
      ["待查", "2 本"],
    ]);
    await sec(colB, "5 現金", [
      ["各班結帳差額", "− 150"],
      ["事後更正", "+ 500(客人補付)"],
      ["退貨退款", "400"],
      ["投庫 / 存銀行", "8,000 / 48,200"],
      ["日結小金庫差異", "0"],
    ]);
    await sec(colB, "6 銀行", [
      ["好運彩券行 末 34521(共用)", "收 88,200 · 支 18,400"],
      ["期末餘額(整個帳戶)", "1,284,300"],
    ]);
    await sec(colB, "7 未結清", [
      ["待退批貨款", "2,000"],
      ["待收調貨款", "1,840"],
    ]);
    await sec(colB, "8 註記", [
      ["跳過盤點", "1 次(人力不足)"],
      ["沒有被日結涵蓋計算的班", "新竹店 3 班"],
      ["前期更正", "0"],
      ["尚未關帳", "2026-09"],
    ]);
    done(sh, Y);
  }
}

if (PART === "DE1") {
  await pageOf("Screen / 經銷商管理");
  const Y = await rowY("經銷商管理(DE-01~08)");
  const tabsDE = ["甲類", "乙類", "關係人"];
  {
    const sh = await shell(
      "DE-01 經銷商管理 / 甲類(列表、快速篩選)",
      "經銷商管理",
      "經銷商管理",
      "經銷商管理",
    );
    add(
      sh.content,
      await titleRow("經銷商管理", null, [await btn("+ 新增經銷商")]),
      "FILL",
    );
    add(sh.content, await tabs(tabsDE, "甲類"), "FILL");
    add(
      sh.content,
      await chips([
        ["逾 150 天", 0],
        ["逾 180 天", 1],
        ["本季未見簽", 0],
      ]),
    );
    add(
      sh.content,
      await table(
        [
          ["證號", 100],
          ["姓名", 90],
          ["共同銷售處所", 160],
          ["距批購", 90],
          ["距本人批購", 100],
          ["本季見簽", 90],
          ["狀態", 90],
        ],
        [
          [
            "12345678",
            "陳志明",
            "好運 2 號店",
            await tag("12 天", "Grey"),
            await tag("152 天", "Warning"),
            await tag("已見簽", "Success"),
            await tag("營業中", "Success"),
          ],
          [
            "87654321",
            "林大同",
            "—",
            await tag("183 天", "Error"),
            await tag("無紀錄", "Error"),
            await tag("未見簽", "Warning"),
            await tag("營業中", "Success"),
          ],
          [
            "23456789",
            "張美華",
            "好運 3 號店",
            await tag("30 天", "Grey"),
            await tag("30 天", "Grey"),
            await tag("已見簽", "Success"),
            await tag("暫停"),
          ],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "N 天標籤:超過 150 天警告色、超過 180 天錯誤色,可依天數排序。側欄計數:逾期、證照到期。",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "DE-02 經銷商管理 / 乙類(列表)",
      "經銷商管理",
      "經銷商管理",
      "經銷商管理",
    );
    add(sh.content, await tabs(tabsDE, "乙類"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["證號", 100],
          ["店名", 140],
          ["姓名", 90],
          ["對應分店", 120],
          ["共同銷售人", 110],
          ["狀態", 90],
        ],
        [
          [
            "11112222",
            "好運 2 號店",
            "王大明",
            "中山店",
            "4 / 6",
            await tag("營業中", "Success"),
          ],
          [
            "33334444",
            "好運 3 號店",
            "李小英",
            await warn("未選分店"),
            await red("7 / 6"),
            await tag("營業中", "Success"),
          ],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "共同銷售人超過 6 位只警告(紅字);沒有對應分店仍可儲存,但提示需要選分店。",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "DE-03 經銷商 新增頁(選類型 → 區塊)",
      "經銷商管理",
      "經銷商管理",
      "新增經銷商",
    );
    const t = add(sh.content, await card("type", 8), "FILL");
    await put(add(t, H(16)), [
      await T("類型(建立後不能改)", "Subtitle/2"),
      await radio("甲類"),
      await radio("乙類", true),
    ]);
    add(
      sh.content,
      await section("經銷商資訊", [
        await grid(
          [
            await field("證號", "33334444"),
            await field("姓名", "李小英"),
            await select("狀態", "營業中", null),
          ],
          3,
        ),
        await grid(
          [
            await field("證照核准日", "2024-03-01"),
            await field("證照到期日", "2027-02-28"),
            await select("代理人", "陳小芳", null),
          ],
          3,
        ),
        await grid([await select("介紹人", "—", null)], 3),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await section("店面", [
        await alert("還沒有選對應分店:可以先儲存,但請盡快選擇。", "Warning"),
        await grid(
          [
            (await node("OrgTreeSelect")).children
              .find(
                (v) => v.name.includes("Closed") && v.name.includes("Single"),
              )
              .createInstance(),
            await field("店名", "好運 3 號店"),
            await field("終端機編號", "T-88021"),
          ],
          3,
        ),
        await grid(
          [
            await field("營業地址", "台北市中山區南京東路 1 段 10 號"),
            await field("店面電話", "0225112233"),
          ],
          2,
        ),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await section("牌租", [], { collapsed: true, summary: "3,000 元 / 月" }),
      "FILL",
    );
    add(
      sh.content,
      await section("基本資訊", [
        await grid(
          [
            await field("身分證字號", "A223456789"),
            await field("生日", "1980-05-12"),
            await field("手機", "0912345678"),
          ],
          3,
        ),
        await grid(
          [
            await field("電話", "0225112233"),
            await field("Email", "lee@example.com"),
          ],
          2,
        ),
        await field("通訊地址", "台北市中山區南京東路 1 段 10 號"),
        await check("戶籍地址同通訊地址", true),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await actions([await btn("儲存")], [await btn("取消", "Text")]),
      "FILL",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "DE-04 甲類 詳情頁(區塊 + 批購紀錄、見簽紀錄)",
      "經銷商管理",
      "經銷商管理",
      "陳志明",
    );
    await docHead(
      sh,
      "陳志明 · 甲類 12345678",
      "營業中",
      "Success",
      "共同銷售處所:好運 2 號店 · 最近一次批購 10/04(12 天)· 最近一次本人批購 05/17(152 天)",
      [await btn("編輯", "Outlined")],
    );
    add(
      sh.content,
      await section("經銷商資訊", [], {
        collapsed: true,
        summary: "代理人 2、受託人 1 · 證照到期 2027-02-28",
      }),
      "FILL",
    );
    add(
      sh.content,
      await section("基本資訊", [], { collapsed: true, summary: "0912345678" }),
      "FILL",
    );
    add(
      sh.content,
      await section("系統資訊", [], {
        collapsed: true,
        summary: "建立 2026-09-01 王總",
      }),
      "FILL",
    );
    add(sh.content, await tabs(["批購紀錄", "見簽紀錄"], "見簽紀錄"), "FILL");
    add(
      sh.content,
      await titleRow("見簽紀錄", "2026 年", [
        await btn("登記見簽", "Outlined"),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["季別", 120],
          ["見簽日", 140],
          ["備註", 300],
          ["狀態", 120],
        ],
        [
          ["Q1", "2026-03-10", "", await tag("已見簽", "Success")],
          ["Q2", "2026-06-02", "", await tag("已見簽", "Success")],
          ["Q3", "—", "", await tag("未登記", "Warning")],
          ["Q4", "—", "", await tag("未到")],
        ],
      ),
      "FILL",
    );
    done(sh, Y);
  }
}

if (PART === "DE2") {
  await pageOf("Screen / 經銷商管理");
  const Y = await rowY("經銷商管理(DE-01~08)");
  {
    const sh = await shell(
      "DE-05 乙類 詳情頁(共同銷售人、預計要給本數、在店庫存)",
      "經銷商管理",
      "經銷商管理",
      "好運 3 號店",
    );
    await docHead(
      sh,
      "好運 3 號店 · 乙類 33334444",
      "營業中",
      "Success",
      "李小英 · 對應分店:未選",
      [await btn("編輯", "Outlined")],
    );
    add(
      sh.content,
      await section("店面", [
        await grid(
          [
            await field("店名", "好運 3 號店"),
            await field("終端機編號", "T-88021"),
            await field("店面電話", "0225112233"),
          ],
          3,
        ),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await section("牌租", [], {
        collapsed: true,
        summary: "3,000 元 / 月 · 每月 5 日",
      }),
      "FILL",
    );
    add(
      sh.content,
      await tabs(["共同銷售人", "預計要給本數", "在店庫存"], "共同銷售人"),
      "FILL",
    );
    add(
      sh.content,
      await alert("共同銷售人 7 位,超過 6 位(只警告)。", "Warning"),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["甲類證號", 120],
          ["姓名", 120],
          ["登記日", 140],
          ["狀態", 120],
        ],
        [
          ["12345678", "陳志明", "2026-09-01", await tag("營業中", "Success")],
          ["23456789", "張美華", "2026-09-03", await tag("暫停")],
          ["…", "另 5 位", "", ""],
        ],
      ),
      "FILL",
    );
    done(sh, Y);
  }
  {
    const { ov, row, fin } = await ovRow(
      "DE-06 Overlay / 登記見簽;移除共同銷售處所的詢問",
    );
    const a = await dcard(row, "登記見簽", 420);
    add(
      a,
      await grid(
        [await select("年度", "2026", null), await select("季別", "Q3", null)],
        2,
      ),
      "FILL",
    );
    add(a, await field("見簽日", "2026-10-02"), "FILL");
    add(a, await field("備註", ""), "FILL");
    await cap(a, "日期不限定落在該季;每季一筆;異動寫稽核紀錄。");
    add(
      a,
      await actions([await btn("取消", "Text"), await btn("登記")]),
      "FILL",
    );
    const b = await dcard(row, "移除共同銷售處所", 460);
    add(
      b,
      await alert(
        "陳志明還有 2 位代理人。甲類要先有共同銷售處所才能設代理人。",
        "Warning",
      ),
      "FILL",
    );
    add(
      b,
      await table(
        [
          ["關聯", 120],
          ["姓名", 160],
        ],
        [
          ["代理人", "陳小芳"],
          ["代理人", "林小玉"],
        ],
      ),
      "FILL",
    );
    add(
      b,
      await actions([
        await btn("取消", "Text"),
        await btn("一併解除並移除", "Contained", "Error"),
      ]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  {
    const sh = await shell(
      "DE-07 經銷商管理 / 關係人(列表)",
      "經銷商管理",
      "經銷商管理",
      "經銷商管理",
    );
    add(
      sh.content,
      await titleRow("經銷商管理", null, [await btn("+ 新增關係人")]),
      "FILL",
    );
    add(sh.content, await tabs(["甲類", "乙類", "關係人"], "關係人"), "FILL");
    add(
      sh.content,
      await filters([
        await select("身分", "全部", 160),
        await select("狀態", "啟用", 140),
        await field("關鍵字(姓名、手機、身分證)", "", { w: 280 }),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["姓名", 120],
          ["身分", 220],
          ["手機", 140],
          ["狀態", 90],
          ["關聯經銷商", 110],
        ],
        [
          [
            "陳小芳",
            [await tag("受託人"), await tag("代理人")],
            "0911222333",
            await tag("啟用", "Success"),
            "2",
          ],
          [
            "林小玉",
            [await tag("代理人")],
            "0922333444",
            await tag("啟用", "Success"),
            "1",
          ],
          [
            "吳介紹",
            [await tag("介紹人")],
            "0933444555",
            await tag("停用"),
            "1",
          ],
        ],
        { right: [4] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "DE-08 關係人 新增 / 詳情頁",
      "經銷商管理",
      "經銷商管理",
      "陳小芳",
    );
    add(
      sh.content,
      await section("基本資料", [
        await grid(
          [
            await field("姓名", "陳小芳"),
            await field("身分證字號", "B223456780"),
            await field("生日", "1985-08-20"),
          ],
          3,
        ),
        await put(H(16), [
          await T("身分(至少一個)"),
          await check("受託人", true),
          await check("代理人", true),
          await check("介紹人"),
        ]),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await section("聯絡資訊", [
        await grid(
          [
            await field("電話", ""),
            await field("手機", "0911222333"),
            await field("Email", "chen@example.com"),
          ],
          3,
        ),
        await field("通訊地址", "新北市板橋區文化路 2 段 5 號"),
        await check("戶籍地址同通訊地址", true),
      ]),
      "FILL",
    );
    add(sh.content, await section("備註", [await field("備註", "")]), "FILL");
    add(
      sh.content,
      await section("系統資訊", [], {
        collapsed: true,
        summary: "建立 2026-09-01 王總",
      }),
      "FILL",
    );
    add(sh.content, await T("關聯的經銷商", "Subtitle/1"));
    add(
      sh.content,
      await table(
        [
          ["經銷商", 220],
          ["類型", 80],
          ["身分", 120],
        ],
        [
          ["陳志明 #12345678", "甲類", "受託人"],
          ["陳志明 #12345678", "甲類", "代理人"],
        ],
      ),
      "FILL",
    );
    add(
      sh.content,
      await actions([await btn("儲存")], [await btn("取消", "Text")]),
      "FILL",
    );
    await cap(
      sh.content,
      "要取消的身分還有關聯時擋下,列出關聯並詢問是否自動解除;被關聯的人不能刪除,只能停用。",
    );
    done(sh, Y);
  }
}

if (PART === "MD") {
  await pageOf("Screen / 檔案管理");
  const Y = await rowY("檔案管理(MD-01~05)");
  {
    const sh = await shell(
      "MD-01 檔案管理 / 遊戲(列表)",
      "檔案管理",
      "檔案管理",
      "檔案管理",
    );
    add(
      sh.content,
      await titleRow("檔案管理", null, [await btn("+ 新增遊戲")]),
      "FILL",
    );
    add(sh.content, await tabs(["遊戲", "收銀點"], "遊戲"), "FILL");
    add(
      sh.content,
      await filters([
        await select("狀態", "販售中", 140),
        await select("面額", "全部", 140),
        await field("關鍵字", "", { w: 220 }),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["代號", 70],
          ["名稱", 140],
          ["顏色", 70],
          ["面額", 70],
          ["張數", 60],
          ["整本金額", 90],
          ["預設批購金額率", 120],
          ["狀態", 90],
          ["上市日", 100],
        ],
        [
          [
            "5201",
            "金好運",
            await chip("黃"),
            "200",
            "100",
            "20,000",
            "92%",
            await tag("販售中", "Success"),
            "2026-10-01",
          ],
          [
            "5164",
            "發大財",
            await chip("紅"),
            "200",
            "100",
            "20,000",
            "92%",
            await tag("販售中", "Success"),
            "2026-06-15",
          ],
          [
            "5133",
            "招財貓",
            await chip("紫"),
            "1,000",
            "25",
            "25,000",
            "92%",
            await tag("販售中", "Success"),
            "2026-03-01",
          ],
          [
            "4980",
            "舊彩",
            await chip("灰"),
            "100",
            "100",
            "10,000",
            "90%",
            await tag("停售"),
            "2025-01-10",
          ],
        ],
        { right: [3, 4, 5, 6] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "MD-02 遊戲 編輯頁(含顏色、有庫存時鎖定)",
      "檔案管理",
      "檔案管理",
      "5164 發大財",
    );
    add(
      sh.content,
      await alert("已有 35 本庫存:代號、單張金額、整本張數已鎖定。", "Info"),
      "FILL",
    );
    add(
      sh.content,
      await section("遊戲資訊", [
        await grid(
          [
            await field("遊戲代號", "5164", {
              state: "Disabled",
              helper: "已有 35 本庫存",
            }),
            await field("遊戲名稱", "發大財"),
            await select("狀態", "販售中", null),
          ],
          3,
        ),
        await grid(
          [
            await field("單張金額", "200", { state: "Disabled" }),
            await field("整本張數", "100", {
              state: "Disabled",
              helper: "選預設面額自動帶入,可改;非標準組合只提示",
            }),
            await field("整本金額", "20,000", {
              state: "Disabled",
              helper: "單張金額 × 張數,系統計算",
            }),
          ],
          3,
        ),
        await grid(
          [
            await field("預設批購金額率(%)", "92", { helper: "整數 0~100" }),
            await field("上市日", "2026-06-15"),
            await field("停售日", ""),
          ],
          3,
        ),
        await grid([await field("兌獎截止日", "")], 3),
      ]),
      "FILL",
    );
    const col = V(8, { name: "color" });
    add(
      col,
      await T("顏色(看板卡片使用,只能從色票選)", "Body/2", "text/secondary"),
    );
    const r = add(col, H(8));
    for (const n of Object.keys(PAL)) {
      const c = await chip(n);
      if (n === "紅") {
        c.strokes = [await paint("text/primary")];
        c.strokeWeight = 2;
      }
      add(r, c);
    }
    add(sh.content, await section("顏色", [col]), "FILL");
    add(sh.content, await section("備註", [await field("備註", "")]), "FILL");
    add(
      sh.content,
      await actions(
        [await btn("儲存")],
        [
          await btn("取消", "Text"),
          await btn("刪除", "Text", "Error", "Disabled"),
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "刪除:只有從來沒被任何本、叫貨單、進貨單引用才能刪除,否則只能停售。停售後不能出現在新的叫貨單與進貨單。",
    );
    done(sh, Y);
  }
  {
    const sh = await shell(
      "MD-03 遊戲 詳情頁(庫存概況、預計要給本數)",
      "檔案管理",
      "檔案管理",
      "5164 發大財",
    );
    await docHead(
      sh,
      "5164 發大財",
      "販售中",
      "Success",
      "200 元 × 100 張 · 整本 20,000 · 預設批購金額率 92%",
      [await btn("編輯", "Outlined")],
    );
    add(
      sh.content,
      await tabs(["庫存概況", "預計要給本數"], "庫存概況"),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["分店", 140],
          ["未拆(本)", 100],
          ["檯面(張)", 100],
          ["已售(張)", 100],
        ],
        [
          ["中山店", "4", "235", "1,862"],
          ["新竹店", "2", "80", "740"],
          ["台中店", "1", "40", "310"],
        ],
        { right: [1, 2, 3] },
      ),
      "FILL",
    );
    done(sh, Y);
  }
  {
    const d = await device("MD-04 遊戲 新增頁(手機寬度)", 390, 844, "新增遊戲");
    for (const f of [
      await field("遊戲代號", "5210"),
      await field("遊戲名稱", "大吉利"),
      await select("單張金額", "500", null),
      await field("整本張數", "50", { helper: "選預設面額自動帶入" }),
      await field("整本金額", "25,000", { state: "Disabled" }),
      await field("預設批購金額率(%)", "92"),
      await field("上市日", "2026-10-20"),
    ])
      add(d.content, f, "FILL");
    add(d.content, await T("顏色", "Body/2", "text/secondary"));
    const r = add(d.content, H(6));
    for (const n of ["藍", "綠", "黃", "紅", "紫"]) add(r, await chip(n));
    const bar = add(
      d.s,
      H(8, {
        name: "sticky-save",
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
      }),
      "FILL",
    );
    bar.fills = [await paint("bg/paper")];
    bar.strokes = [await paint("divider")];
    bar.strokeTopWeight = 1;
    bar.strokeBottomWeight = bar.strokeLeftWeight = bar.strokeRightWeight = 0;
    add(bar, await btn("取消", "Text"));
    spacer(bar);
    add(bar, await btn("儲存"));
    done(d.s, Y);
  }
  {
    const sh = await shell(
      "MD-05 檔案管理 / 收銀點(列表 + 新增 / 編輯)",
      "檔案管理",
      "檔案管理",
      "檔案管理",
    );
    add(
      sh.content,
      await titleRow("檔案管理", null, [await btn("+ 新增收銀點")]),
      "FILL",
    );
    add(sh.content, await tabs(["遊戲", "收銀點"], "收銀點"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["分店", 100],
          ["名稱", 120],
          ["對應崗位", 110],
          ["排序", 60],
          ["印表機", 160],
          ["狀態", 90],
        ],
        [
          [
            "中山店",
            "店內櫃台",
            "櫃台",
            "1",
            "櫃台收據機",
            await tag("啟用", "Success"),
          ],
          [
            "中山店",
            "店外攤位",
            "攤位",
            "2",
            "(用分店預設)",
            await tag("啟用", "Success"),
          ],
          [
            "中山店",
            "彩券機旁",
            "機台",
            "3",
            "(用分店預設)",
            await tag("停用"),
          ],
        ],
      ),
      "FILL",
    );
    done(sh, Y);
    const { ov, dlg } = await overlay(
      "MD-05 Overlay / 收銀點 新增 / 編輯",
      480,
    );
    await dhead(dlg, "編輯收銀點");
    add(dlg, await select("分店", "中山店", null), "FILL");
    add(dlg, await select("對應崗位(必填)", "櫃台", null), "FILL");
    add(
      dlg,
      await field("名稱", "店內櫃台", {
        helper: "選了崗位自動帶入,可改;同一家分店內不重複",
      }),
      "FILL",
    );
    add(
      dlg,
      await grid(
        [await field("排序", "1"), await select("印表機", "櫃台收據機", null)],
        2,
      ),
      "FILL",
    );
    add(dlg, await sw("啟用", true));
    await cap(dlg, "有開著的班或檯面上還有張數時不能停用;不能刪除,只能停用。");
    add(
      dlg,
      await actions([await btn("取消", "Text"), await btn("儲存")]),
      "FILL",
    );
    done({ ov }, Y);
  }
}
return { made };
