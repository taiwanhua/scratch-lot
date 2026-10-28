/**
 * Figma 稽核腳本(scripts/figma-audit/)的離線測試:
 * 共用腳本不含專案名詞與寫死的節點 id、設定 + 腳本能照 use_figma 的形狀解析,
 * 以及各項稽核數字在 fake Figma 上的行為。真正的 Figma 檔不在 CI 執行。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import {
  fakeFigma,
  readScript,
  runAudit,
  runWithConfigSource,
  solid,
  testConfig,
} from "./test-support.mjs";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const dir = new URL("./", import.meta.url);
const SCRIPTS = readdirSync(dir).filter((f) => /^audit.*\.js$/.test(f));
const configSource = readFileSync(
  new URL("./project/config.js", import.meta.url),
  "utf8",
);
const projectConfig = vm.runInNewContext(`${configSource}\nAUDIT_CONFIG;`, {});

test("五支共用腳本都在", () => {
  assert.deepEqual(SCRIPTS.sort(), [
    "audit-crossview.js",
    "audit-layout.js",
    "audit-legend.js",
    "audit-sync.js",
    "audit.js",
  ]);
});

test("共用腳本與 README 不含專案設定列的專案名詞", () => {
  const files = [...SCRIPTS, "README.md"];
  for (const file of files) {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    for (const term of projectConfig.projectTerms)
      assert.ok(!text.includes(term), `${file} 含專案名詞「${term}」`);
  }
});

test("共用腳本沒有寫死節點 id 或變數集合 key", () => {
  for (const file of SCRIPTS) {
    const text = readScript(file);
    assert.doesNotMatch(text, /["'`]\d+:\d+["'`]/, `${file} 寫死節點 id`);
    assert.doesNotMatch(text, /[0-9a-f]{40}/, `${file} 寫死變數集合 key`);
  }
});

test("專案設定 + 每支腳本可照 use_figma 的形狀解析(沒有重複宣告)", () => {
  for (const file of SCRIPTS)
    assert.doesNotThrow(
      () => new AsyncFunction("figma", `${configSource}\n${readScript(file)}`),
      file,
    );
});

test("專案設定有腳本讀的全部欄位", () => {
  const keys = Object.keys(testConfig()).sort();
  assert.deepEqual(Object.keys(projectConfig).sort(), keys);
  for (const group of ["layout", "sync", "legend", "audit"])
    assert.deepEqual(
      Object.keys(projectConfig[group]).sort(),
      Object.keys(testConfig()[group]).sort(),
      group,
    );
});

test("沒填檔頭參數或沒貼設定時直接報錯", async () => {
  const { figma } = fakeFigma();
  await assert.rejects(
    runAudit("audit-layout.js", figma, testConfig()),
    /PAGE_ID 未填/,
  );
  await assert.rejects(
    new AsyncFunction("figma", readScript("audit-sync.js"))(figma),
    /先貼 project\/config\.js/,
  );
  await assert.rejects(
    runWithConfigSource(configSource, "audit-crossview.js", figma, {
      RULE: "none",
    }),
    /crossView 沒有規則/,
  );
});

// ---- audit-layout ----

function layoutScene({ pageName = "Screen / 測試" } = {}) {
  const { figma, n, collection } = fakeFigma();
  const base = collection("base-color", {
    "primary/main": { r: 1, g: 0.5, b: 0 },
  });
  const field = (name, ay) =>
    n("INSTANCE", {
      name,
      ax: name === "TextField" ? 0 : 210,
      ay,
      width: 200,
      height: 56,
      mainComponent: { name, parent: null },
    });
  const screen = n("FRAME", { name: "AA-01 畫面", width: 1440, height: 900 }, [
    // clippedText ×2:被 clipsContent 父框切到、設了截斷
    n("FRAME", { name: "clip", width: 100, height: 20, clipsContent: true }, [
      n("TEXT", { characters: "超出的文字", width: 150, height: 20 }),
    ]),
    n("TEXT", {
      characters: "截斷",
      ay: 50,
      width: 100,
      height: 20,
      textTruncation: "ENDING",
    }),
    // misalignedRows ×1
    n(
      "FRAME",
      {
        name: "row",
        ay: 100,
        width: 600,
        height: 60,
        layoutMode: "HORIZONTAL",
      },
      [field("TextField", 100), field("SelectField", 104)],
    ),
    // overflowNodes ×1
    n(
      "FRAME",
      { name: "box", ay: 200, width: 100, height: 50, layoutMode: "VERTICAL" },
      [n("FRAME", { name: "wide", ay: 200, width: 150, height: 20 })],
    ),
    // overlapText ×1(浮層不算)
    n("FRAME", { name: "cell", ay: 300, width: 300, height: 100 }, [
      n("TEXT", { characters: "09:00", ay: 300, width: 80, height: 20 }),
      n("INSTANCE", { name: "Icon", ax: 10, ay: 300, width: 20, height: 20 }),
      n("INSTANCE", { name: "選單(浮層)", ay: 300, width: 200, height: 80 }),
    ]),
    // overflowTextInInstance ×1
    n(
      "INSTANCE",
      {
        name: "Chip",
        ax: 400,
        ay: 300,
        width: 40,
        height: 20,
        fills: [solid({ r: 0.9, g: 0.9, b: 0.9 })],
      },
      [
        n("TEXT", {
          characters: "很長的字",
          ax: 400,
          ay: 300,
          width: 60,
          height: 20,
        }),
      ],
    ),
    // rowGapInContainer ×1(間距 10,不是 4)
    n("FRAME", { name: "lane", ay: 500, width: 300, height: 100 }, [
      n("INSTANCE", { name: "Container", ay: 500, width: 300, height: 100 }),
      n("INSTANCE", { name: "Bar 1", ay: 500, width: 300, height: 20 }),
      n("INSTANCE", { name: "Bar 2", ay: 530, width: 300, height: 20 }),
    ]),
    // basePrimaryBindings ×1
    n("RECTANGLE", {
      name: "accent",
      ax: 1000,
      width: 10,
      height: 10,
      fills: [solid({ r: 1, g: 0.5, b: 0 }, base["primary/main"])],
    }),
  ]);
  const page = n("PAGE", { name: pageName }, [
    n("SECTION", { name: "電腦 1440", width: 3000, height: 3000 }, [screen]),
  ]);
  return { figma, page };
}

test("audit-layout:每一項各抓到一個問題", async () => {
  const { figma, page } = layoutScene();
  const r = await runAudit("audit-layout.js", figma, testConfig(), {
    PAGE_ID: page.id,
  });
  assert.equal(r.screens, 1);
  assert.equal(r.clippedText, 2);
  assert.deepEqual(r.clippedSample.map((x) => x.why).sort(), [
    "clipped",
    "truncation",
  ]);
  assert.equal(r.misalignedRows, 1);
  assert.equal(r.overflowNodes, 1);
  assert.equal(r.overlapText, 1);
  assert.equal(r.overlapSample[0].name, "Icon");
  assert.equal(r.overflowTextInInstance, 1);
  assert.equal(r.rowGapInContainer, 1);
  assert.equal(r.rowGapSample[0].gaps, "10");
  assert.equal(r.basePrimaryBindings, 1);
});

test("audit-layout:底座草稿頁不查底座主色;rowGap 設 null 時回報 null", async () => {
  const { figma, page } = layoutScene({ pageName: "Base Draft / 草稿" });
  const config = testConfig();
  config.layout.rowGap = null;
  const r = await runAudit("audit-layout.js", figma, config, {
    PAGE_ID: page.id,
  });
  assert.equal(r.basePrimaryBindings, null);
  assert.equal(r.rowGapInContainer, null);
});

// ---- audit-sync ----

function syncScene() {
  const { figma, n } = fakeFigma();
  const button = (text) =>
    n("INSTANCE", { name: "Button" }, [n("TEXT", { characters: text })]);
  const desktop = n("SECTION", { name: "電腦 1440" }, [
    n("FRAME", { name: "AA-01 列表", width: 1440, height: 900 }, [
      n("FRAME", { name: "toolbar" }, [button("新增"), button("篩選")]),
      n("FRAME", { name: "header" }),
    ]),
    // 手機畫面放錯 Section
    n("FRAME", { name: "AA-02 詳情 · 手機", width: 390, height: 844 }),
    // 遮罩沒有背景頁、scrim 沒蓋滿
    n("FRAME", { name: "AA-03 對話框", width: 1440, height: 900 }, [
      n("FRAME", { name: "scrim", width: 1440, height: 400 }),
      n("FRAME", { name: "dialog", ax: 500, ay: 300, width: 440, height: 300 }),
    ]),
  ]);
  const mobile = n("SECTION", { name: "手機 390", ax: 0, ay: 2000 }, [
    n(
      "FRAME",
      { name: "AA-01 列表 · 手機", ay: 2000, width: 390, height: 844 },
      [
        n("FRAME", { name: "toolbar" }, [button("篩選")]),
        // 全螢幕對話框的 app bar(Kind=Dialog)不算標題列,它的按鈕不比
        n(
          "INSTANCE",
          {
            name: "MobileAppBar",
            componentProperties: { Kind: { value: "Dialog" } },
          },
          [button("儲存")],
        ),
      ],
    ),
  ]);
  const page = n("PAGE", { name: "Screen / 測試" }, [desktop, mobile]);
  return { figma, page, n };
}

test("audit-sync:按鈕不一致、共用區塊、寬度、篩選抽屜、遮罩", async () => {
  const { figma, page } = syncScene();
  const config = testConfig();
  config.sync.pages = [page.id];
  const r = await runAudit("audit-sync.js", figma, config);
  assert.deepEqual(r.syncList, ["測試 AA-01「新增」缺 M"]);
  assert.deepEqual(r.sharedList, ["測試 AA-01 列表:header(要用 PageHeader)"]);
  assert.equal(r.sectionMismatch, 1);
  assert.match(r.sectionList[0], /AA-02 詳情 · 手機 w390/);
  assert.deepEqual(r.filterList, ["測試 AA-01 列表 · 手機"]);
  assert.equal(r.overlayNoPage, 1);
  assert.equal(r.overlayNotCovering, 1);
  assert.deepEqual(r.groupsPerPage, { 測試: 3 });
});

test("audit-sync:例外與註解寫明照共用規則都不算", async () => {
  const { figma, page, n } = syncScene();
  const config = testConfig();
  config.sync.pages = [page.id];
  config.sync.exempt = { "AA-01|新增|M": "手機收進更多" };
  const mobile = page.children[1];
  const note = n("TEXT", {
    name: "AA-01 列表 · 手機 · 註解",
    characters: "照共用篩選抽屜",
  });
  note.parent = mobile;
  mobile.children.push(note);
  const r = await runAudit("audit-sync.js", figma, config);
  assert.equal(r.syncDiffs, 0);
  assert.deepEqual(r.exempted, ["AA-01|新增|M:手機收進更多"]);
  assert.equal(r.filterDrawerMissing, 0);
});

// ---- audit-legend ----

function legendScene({ withWarningSample = true } = {}) {
  const { figma, n, collection } = fakeFigma();
  const v = collection("base-color", {
    "warning/main": { r: 1, g: 0.6, b: 0 },
    "info/main": { r: 0, g: 0.5, b: 1 },
  });
  const item = (label, varName) =>
    n(
      "INSTANCE",
      {
        name: "LegendItem",
        mainComponent: {
          name: "Kind=Dot",
          parent: { type: "COMPONENT_SET", name: "LegendItem" },
        },
        componentProperties: { Label: { value: label } },
      },
      [
        n("RECTANGLE", {
          name: "marker",
          fills: [solid({ r: 0, g: 0, b: 0 }, v[varName])],
        }),
      ],
    );
  const legend = n("FRAME", { name: "legend" }, [
    ...(withWarningSample ? [item("注意", "warning/main")] : []),
    item("資訊", "info/main"),
  ]);
  const screen = n("FRAME", { name: "AA-01 畫面", width: 1440, height: 900 }, [
    legend,
    n("RECTANGLE", {
      name: "mark",
      fills: [solid({ r: 0, g: 0, b: 0 }, v["warning/main"])],
    }),
    n("RECTANGLE", { name: "raw", fills: [solid({ r: 0.5, g: 0.5, b: 0.5 })] }),
  ]);
  const page = n("PAGE", { name: "Screen / 測試" }, [screen]);
  return { figma, page };
}

test("audit-legend:沒綁色票、圖例樣本畫面沒用到", async () => {
  const { figma, page } = legendScene();
  const r = await runAudit("audit-legend.js", figma, testConfig(), {
    PAGE_ID: page.id,
  });
  assert.equal(r.unboundColors, 1);
  assert.equal(r.legendMismatch, 1);
  assert.match(r.mismatchSample[0], /圖例「資訊」/);
});

test("audit-legend:畫面的標示色在圖例找不到樣本", async () => {
  const { figma, page } = legendScene({ withWarningSample: false });
  const r = await runAudit("audit-legend.js", figma, testConfig(), {
    PAGE_ID: page.id,
  });
  assert.equal(r.legendMismatch, 2);
  assert.ok(r.mismatchSample.some((x) => /warning\/main/.test(x)));
});

test("audit-legend:例外頁的「圖例樣本畫面沒用到」照列理由、不算錯;標示色沒樣本照算", async () => {
  const { figma, page } = legendScene({ withWarningSample: false });
  const config = testConfig();
  config.legend.exempt = { [page.id]: "圖例照程式清單" };
  const r = await runAudit("audit-legend.js", figma, config, {
    PAGE_ID: page.id,
  });
  assert.equal(r.legendMismatch, 1);
  assert.match(r.mismatchSample[0], /warning\/main/);
  assert.equal(r.legendExempted, 1);
  assert.equal(r.exemptReason, "圖例照程式清單");
  assert.match(r.exemptedSample[0], /圖例「資訊」/);
});

// ---- audit ----

test("audit:草稿元件、非底座綁定、草稿色票、參考畫面、開發文字、畫布重疊", async () => {
  const { figma, n, collection } = fakeFigma();
  const other = collection("other-lib", { "x/main": { r: 0, g: 0, b: 0 } });
  const draft = collection(
    "local-draft",
    { "blue/bg": { r: 0, g: 0, b: 1 } },
    { name: "Draft/tagPalettes", remote: false },
  );
  const comp = n(
    "COMPONENT",
    {
      name: "Draft/Thing",
      description: "【底座・本輪草稿】",
      width: 100,
      height: 100,
    },
    [
      n("RECTANGLE", {
        name: "bad",
        fills: [solid({ r: 0, g: 0, b: 0 }, other["x/main"])],
      }),
      n("RECTANGLE", {
        name: "tag",
        fills: [solid({ r: 0, g: 0, b: 1 }, draft["blue/bg"])],
      }),
    ],
  );
  const inst = n("INSTANCE", { name: "Draft/Thing", mainComponent: comp });
  comp.remote = false;
  const page = n("PAGE", { name: "Base Draft / 草稿" }, [
    comp,
    n("FRAME", { name: "BS-01 畫面", ax: 200, width: 1440, height: 900 }, [
      inst,
    ]),
    n("FRAME", { name: "畫面2", ax: 1700, width: 300, height: 300 }, [
      n("TEXT", { characters: "見 AA-01" }),
    ]),
    n("FRAME", { name: "畫面3", ax: 1800, ay: 100, width: 100, height: 100 }),
  ]);
  const r = await runAudit("audit.js", figma, testConfig(), {
    PAGE_ID: page.id,
  });
  assert.equal(r.baseDraftComponents, 1);
  assert.equal(r.instancesOfBaseDrafts, 1);
  assert.equal(r.nodesWithDraftMarker, 1);
  assert.equal(r.nonBaseBindingsInBaseDrafts, 1);
  assert.equal(r.draftTokenBindings, 1);
  assert.equal(r.baseScreensNotFromRef, 1);
  assert.match(r.baseScreensSample[0], /沒有「對應現有畫面」註解/);
  assert.equal(r.devTextInScreens, 1);
  assert.equal(r.canvasOverlap, 1);
  assert.equal(r.basePrimaryBindings, null);
});

// ---- audit-crossview ----

test("audit-crossview:依專案規則比對各畫面與參考畫面", async () => {
  const { figma, n } = fakeFigma();
  const grid = (text, extra) =>
    n("FRAME", { name: "Grid" }, [
      n("TEXT", { name: "a", characters: text }),
      ...(extra ? [n("TEXT", { name: "b", characters: extra })] : []),
    ]);
  const ref = n("FRAME", { name: "AA-01" }, [grid("10")]);
  const page = n("PAGE", { name: "Screen / 測試" }, [
    ref,
    n("FRAME", { name: "AA-02" }, [grid("12")]),
    n("FRAME", { name: "AA-03" }, [grid("10", "只在這裡")]),
  ]);
  const config = testConfig();
  config.crossView.grid = {
    page: page.id,
    ref: ref.id,
    target: (x) => x.name === "Grid",
    signature: (g) =>
      Object.fromEntries(g.children.map((c) => [c.name, c.characters])),
  };
  const r = await runAudit("audit-crossview.js", figma, config, {
    RULE: "grid",
  });
  assert.equal(r.targets, 3);
  assert.equal(r.total, 1);
  assert.match(r.res[0], /^AA-02.*a: 12 ≠ 10/);

  config.crossView.grid.same = () => true;
  const loose = await runAudit("audit-crossview.js", figma, config, {
    RULE: "grid",
  });
  assert.equal(loose.total, 0);
});
