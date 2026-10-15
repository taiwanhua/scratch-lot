// 週模式排版(底座規格 10.11「週模式排版」、專案規格 14.5「週檢視排版」)。
// r6-week.js 與 r6-timeline-cases.js 共用同一個函式:兩支腳本執行前都先貼上本檔(畫面位置一律由這裡算,不手填座標)。
// 純函式:同樣輸入一定同樣輸出;不依賴輸入陣列順序(先依完整排序鍵排序)。
//   groups:[{ id, a, b, slots, ord?, tmpl?, created? }]
//     a / b   開始 / 結束(小時,b 不含;早班結束 14.5 與晚班開始 14.5 不算重疊)
//     slots   佔的條數 = max(需求人數, 已排人數)(缺額佔條數裡的空位)
//     ord     崗位排序、tmpl 範本排序(沒套範本的「臨」排最後)、created 建立時間、id 唯一
//   dayWidth:一天欄寬(電腦 157、平板 125,以設計稿實際欄寬為準)
// 回傳 { placed: [{ g, x, w }], hidden: [g] }:x 是容器在當天欄內的左邊位置(0 起),w = 20 + 28 × slots。
// 規則:依排序逐一放,從最左邊找第一個「整段時間內都空得下 w」的位置;找不到就整筆收起;已放好的不移動;
//   時間不重疊的容器可共用同一位置。只要有收起,保留最右邊 24px 給「+N」長條,從頭重排一次。
const TL_TITLE = 20; // 容器左側直排標題
const TL_SLOT = 28; // 一條寬
const TL_MORE = 24; // 「+N」長條保留寬
const tlWidth = (g) => TL_TITLE + TL_SLOT * g.slots;
const tlCmp = (p, q) =>
  p.a - q.a ||
  (p.ord ?? 0) - (q.ord ?? 0) ||
  (p.tmpl ?? 0) - (q.tmpl ?? 0) ||
  (p.created ?? 0) - (q.created ?? 0) ||
  (String(p.id) < String(q.id) ? -1 : String(p.id) > String(q.id) ? 1 : 0);
function layoutTimeline(groups, dayWidth) {
  const sorted = [...groups].sort(tlCmp);
  const run = (avail) => {
    const placed = [],
      hidden = [];
    for (const g of sorted) {
      const w = tlWidth(g);
      const ov = placed.filter((p) => p.g.a < g.b && g.a < p.g.b);
      const cands = [0, ...ov.map((p) => p.x + p.w)].sort((m, n) => m - n);
      const x = cands.find(
        (c) =>
          c + w <= avail && ov.every((p) => c + w <= p.x || c >= p.x + p.w),
      );
      if (x === undefined) hidden.push(g);
      else placed.push({ g, x, w });
    }
    return { placed, hidden };
  };
  const r = run(dayWidth);
  return r.hidden.length ? run(dayWidth - TL_MORE) : r;
}
// 「+N」長條的 Tone:收起的有缺負責 Error、有缺協同 Warning、否則 Neutral(由模組決定;這裡用 items 裡的缺額判斷)
const tlMoreTone = (hidden) =>
  hidden.some((g) => g.items.some((p) => p.vac === "err"))
    ? "Error"
    : hidden.some((g) => g.items.some((p) => p.vac))
      ? "Warning"
      : "Neutral";
// 容器內長條順序:負責 → 協同 → 缺額(同類維持資料順序)
const tlOrder = (items) =>
  items
    .map((p, i) => [
      Array.isArray(p) ? 1 : p.vac ? 2 : p.dis ? 1 : p.lead ? 0 : 1,
      i,
      p,
    ])
    .sort((m, n) => m[0] - n[0] || m[1] - n[1])
    .map((t) => t[2]);
