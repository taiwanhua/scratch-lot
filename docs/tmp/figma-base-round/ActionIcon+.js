// Draft/ActionIcon+:本輪新增的通用圖示(MUI Outlined 路徑,24×24,向量綁 Primitives grey/700)。
// 搬回底座時:把每個變體併入既有 Draft/ActionIcon(2001:68)成為新的 key= 變體,
// 再把 scratch-lot 內所有 Draft/ActionIcon+ 實例 swap 到 Draft/ActionIcon 的同名 key 變體。
// 前置:貼上 _resolve.js;在目標頁執行。
const ICONS = {
  "expand-more": "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
  "expand-less": "m12 8-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z",
  "chevron-left": "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  "chevron-right": "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  "arrow-drop-down": "M7 10l5 5 5-5z",
  search:
    "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14",
  notifications:
    "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2m6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5z",
  print:
    "M19 8h-1V3H6v5H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3M8 5h8v3H8zm8 14H8v-4h8zm2-4v-2H6v2H4v-4c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v4zm0-3.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2",
  download:
    "M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3zm-1-4-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z",
  link: "M17 7h-4v2h4c1.65 0 3 1.35 3 3s-1.35 3-3 3h-4v2h4c2.76 0 5-2.24 5-5s-2.24-5-5-5m-6 8H7c-1.65 0-3-1.35-3-3s1.35-3 3-3h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4zm-3-4h8v2H8z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  "check-circle":
    "M16.59 7.58 10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8",
  "error-outline":
    "M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8",
  "account-tree":
    "M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3zM7 9H4V5h3zm10 6h3v4h-3zm0-10h3v4h-3z",
  "more-vert":
    "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2",
  menu: "M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z",
  "more-horiz":
    "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2",
};

const old = figma.currentPage.findOne(
  (n) => n.type === "COMPONENT_SET" && n.name === "Draft/ActionIcon+",
);
if (old)
  throw new Error(
    "Draft/ActionIcon+ 已存在(id " + old.id + "),要重建請先手動確認刪除",
  );

const grey = await paint("grey/700");
const variants = [];
for (const [key, d] of Object.entries(ICONS)) {
  const svg = figma.createNodeFromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${d}"/></svg>`,
  );
  const c = figma.createComponent();
  c.name = "key=" + key;
  c.resize(24, 24);
  c.fills = [];
  c.clipsContent = false;
  for (const child of [...svg.children]) {
    c.appendChild(child);
    child.name = "glyph";
    if ("fills" in child) child.fills = [grey];
  }
  svg.remove();
  variants.push(c);
}
const set = figma.combineAsVariants(variants, figma.currentPage);
set.name = "Draft/ActionIcon+";
set.layoutMode = "HORIZONTAL";
set.layoutWrap = "WRAP";
set.itemSpacing = 16;
set.counterAxisSpacing = 16;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
set.primaryAxisSizingMode = "FIXED";
set.counterAxisSizingMode = "AUTO";
set.resize(16 * 2 + 8 * 24 + 7 * 16, set.height);
set.description =
  DESC_PREFIX +
  "本輪新增的通用圖示(@repo/ui/icons,MUI Outlined 路徑,24×24,向量綁 Primitives grey/700,顏色跟隨文字色、實例可覆寫)。搬回底座時每個變體併入既有 Draft/ActionIcon(2001:68)成為同名 key= 變體,之後本檔實例 swap 到 Draft/ActionIcon。" +
  "expand-more / expand-less:Section 收合鈕、樹節點;chevron-left / chevron-right:月曆換月、樹展開;arrow-drop-down:下拉觸發;search:搜尋框;notifications:通知鈴;print:列印鈕;download:代理程式下載;copy:複製伺服器網址 / 配對碼;link:連結;close:關閉;check / check-circle / error-outline:列印結果與通知狀態;account-tree:組織樹;more-vert:列操作選單。";
return {
  setId: set.id,
  variants: set.children.map((v) => v.name + " " + v.id),
};
