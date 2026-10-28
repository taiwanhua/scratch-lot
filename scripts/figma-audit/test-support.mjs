/**
 * 稽核腳本的離線測試工具:最小的 fake Figma(節點樹、變數、元件),
 * 以及「設定 + 稽核腳本」在 AsyncFunction 裡執行的 runner(與 use_figma 貼上執行同一形狀)。
 * 只實作稽核腳本讀到的 Plugin API;不是完整的 Figma 模擬。
 */
import { readFileSync } from "node:fs";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export const readScript = (name) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** 以 use_figma 的形狀執行:設定檔原文 + 腳本原文接在一起,當作 async 函式本體。 */
export async function runWithConfigSource(configSource, name, figma, params) {
  const body = `${configSource}\n${withParams(readScript(name), params)}`;
  return new AsyncFunction("figma", body)(figma);
}

/** 以設定物件執行(測試用中性設定,含 RegExp / 函式,不必寫成原文)。 */
export async function runAudit(name, figma, config, params) {
  const body = withParams(readScript(name), params);
  return new AsyncFunction("figma", "AUDIT_CONFIG", body)(figma, config);
}

function withParams(source, params = {}) {
  let out = source;
  for (const [key, value] of Object.entries(params)) {
    const blank = `const ${key} = "";`;
    if (!out.includes(blank)) throw new Error(`腳本沒有檔頭參數 ${key}`);
    out = out.replace(blank, `const ${key} = ${JSON.stringify(value)};`);
  }
  return out;
}

/** 測試用中性設定:欄位與 project/config.js 相同,值不含任何專案名詞。 */
export const testConfig = () => ({
  projectTerms: [],
  baseDraftPagePrefix: "Base Draft",
  draftMarker: "本輪草稿",
  draftCollectionPrefix: "Draft/",
  baseCollections: [
    "base-color",
    "base-radius",
    "base-primitives",
    "base-brand",
  ],
  basePrimaryCollections: ["base-color", "base-brand"],
  layout: {
    field: /TextField|SelectField/,
    rowGap: {
      container: /^Container/,
      rows: /^Bar/,
      gap: 4,
      minWidthRatio: 0.6,
    },
  },
  sync: {
    pages: ["1:1"],
    overlayOnlyPages: [],
    pageLabel: (name) => name.replace(/^Screen \/ /, ""),
    sizes: {
      "電腦 1440": { code: "D", width: 1440 },
      "平板 1024": { code: "T", width: 1024 },
      "手機 390": { code: "M", width: 390 },
    },
    sizeSuffix: { " · 平板": "平板 1024", " · 手機": "手機 390" },
    screenCode: /^([A-Z]{2}-\d\d)/,
    nonButton: /Tag|AppBar/,
    headInstance: /PageHeader/,
    headFrame: /^toolbar$/,
    appBar: { name: /MobileAppBar/, kindProp: "Kind", skipKind: "Dialog" },
    merged: [],
    exempt: {},
    sharedBlocks: [
      { frame: /^header$/, why: "要用 PageHeader" },
      { frame: /^cards$/, children: "卡片要用 Card" },
      { frame: /^steps$/, contains: [[/StepperStep/, "要用 StepperStep"]] },
    ],
    filterButton: /^篩選/,
    filterDrawer: /篩選/,
    filterNote: /照共用篩選/,
  },
  legend: {
    mark: ["warning/main"],
    markers: /^Marker$/,
    legendItem: "LegendItem",
    legendLabelProp: "Label",
    exempt: {},
  },
  audit: {
    devText: [/\bAA-\d{2}\b/, /規格/],
    baseRefScreen: /^BS-/,
    baseRefWidth: 1440,
    baseRefNote: "對應現有畫面",
    baseAppBar: /AdminAppBar/,
  },
  crossView: {},
});

const CONTAINERS = new Set([
  "PAGE",
  "SECTION",
  "FRAME",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
]);

/**
 * 建一個 fake Figma 檔。`n(type, props, children)` 建節點;座標用絕對座標 `ax` / `ay`,
 * 節點的 `x` / `y` 依父層換算(與 Figma 相同:相對於父框,頁與 Section 的直屬子節點相對於 Section)。
 */
export function fakeFigma() {
  const nodes = new Map();
  const variables = new Map();
  const collections = new Map();
  let seq = 0;

  const descendants = (root) => {
    const out = [];
    const walk = (x) => {
      for (const c of x.children || []) {
        out.push(c);
        if (c.children) walk(c);
      }
    };
    walk(root);
    return out;
  };

  function n(type, props = {}, children = []) {
    const node = {
      type,
      id: `9${++seq}:1`,
      name: "",
      visible: true,
      ax: 0,
      ay: 0,
      width: 0,
      height: 0,
      parent: null,
      ...props,
    };
    nodes.set(node.id, node);
    if (type === "PAGE") node.loadAsync = async () => {};
    if (type !== "PAGE" && type !== "SECTION") {
      node.fills ??= [];
      node.strokes ??= [];
    }
    if (type === "TEXT") {
      node.characters ??= "";
      node.textAutoResize ??= "WIDTH_AND_HEIGHT";
      node.textTruncation ??= "DISABLED";
      node.fontSize ??= 14;
    }
    if (type !== "PAGE" && type !== "SECTION")
      node.layoutPositioning ??= "AUTO";
    if (["FRAME", "COMPONENT", "INSTANCE"].includes(type)) {
      node.layoutMode ??= "NONE";
      node.clipsContent ??= false;
      for (const k of [
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
      ])
        node[k] ??= 0;
    }
    if (type === "INSTANCE") {
      node.componentProperties ??= {};
      node.getMainComponentAsync = async () => node.mainComponent ?? null;
    }
    if (type === "SECTION") node.loadAsync = async () => {};
    Object.defineProperty(node, "x", {
      get: () =>
        node.ax -
        (node.parent && node.parent.type !== "PAGE" ? node.parent.ax : 0),
    });
    Object.defineProperty(node, "y", {
      get: () =>
        node.ay -
        (node.parent && node.parent.type !== "PAGE" ? node.parent.ay : 0),
    });
    if (type !== "PAGE")
      Object.defineProperty(node, "absoluteBoundingBox", {
        get: () => ({
          x: node.ax,
          y: node.ay,
          width: node.width,
          height: node.height,
        }),
      });
    if (CONTAINERS.has(type)) {
      node.children = [];
      node.findAll = (fn = () => true) => descendants(node).filter(fn);
      node.findOne = (fn) => descendants(node).find(fn) ?? null;
      node.findChild = (fn) => node.children.find(fn) ?? null;
      node.findAllWithCriteria = ({ types }) =>
        descendants(node).filter((x) => types.includes(x.type));
      for (const c of children) {
        c.parent = node;
        node.children.push(c);
      }
    }
    return node;
  }

  /** 建一個變數集合;`vars` 是 { 名稱: {r,g,b} },回傳 { 名稱: 變數 id }。 */
  function collection(key, vars, { name = key, remote = true } = {}) {
    const colId = `VariableCollectionId:${key}`;
    collections.set(colId, { id: colId, key, name, remote });
    const ids = {};
    for (const [vName, color] of Object.entries(vars)) {
      const id = `VariableID:${key}/${vName}`;
      variables.set(id, {
        id,
        name: vName,
        variableCollectionId: colId,
        resolveForConsumer: () => ({ value: color }),
      });
      ids[vName] = id;
    }
    return ids;
  }

  const figma = {
    skipInvisibleInstanceChildren: false,
    getNodeByIdAsync: async (id) => nodes.get(id) ?? null,
    setCurrentPageAsync: async () => {},
    variables: {
      getVariableByIdAsync: async (id) => variables.get(id) ?? null,
      getVariableCollectionByIdAsync: async (id) => collections.get(id) ?? null,
    },
  };
  return { figma, n, collection };
}

/** SOLID paint;給 `varId` 時綁變數。 */
export const solid = (color, varId, extra = {}) => ({
  type: "SOLID",
  color,
  opacity: 1,
  visible: true,
  ...(varId
    ? { boundVariables: { color: { type: "VARIABLE_ALIAS", id: varId } } }
    : {}),
  ...extra,
});
