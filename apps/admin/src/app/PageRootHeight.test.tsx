import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { PERSONAL_SETTINGS_PATH } from "@/lib/base/paths";
import { mockHandlers, mockModules } from "@/mock/mock-world";
import {
  LIST_PIN_MIN_WIDTH,
  heightChainOf,
  isListPageShell,
  squeezedPageRootProblem,
} from "@/test/height-chain";
import { server } from "@/test/msw/server";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { renderApp } from "@/test/render";

import { modulePages } from "./module-pages";

// 流程管理的設計器用 React Flow(jsdom 沒有 ResizeObserver / DOMMatrixReadOnly)
setupReactFlowEnvironment();

beforeAll(async () => {
  // 懶載入頁面的依賴鏈先載好,不算進 findBy* / waitFor 的等待(TEST-08)
  await Promise.all([
    import("@/pages/base/system/FormsPage/FormsPage"),
    import("@/pages/base/system/WorkflowsPage/WorkflowsPage"),
    import("@/pages/base/system/WorkflowBlockedPage/WorkflowBlockedPage"),
    import("@/pages/base/system/PrintersPage/PrintersPage"),
    import("@/pages/base/apply-center/ApplyCenterPage/ApplyCenterPage"),
  ]);
});

/**
 * 殼內每一頁的頁面根都不會被殼的 flex 欄壓扁、裁掉內容(STYLE-08;規則本體見 `squeezedPageRootProblem`)。
 *
 * 頁面清單不手寫:取 mock 開發模式的假世界(TEST-08)裡**有登記頁面、不需要網址參數**的模組
 * (列表頁與新增頁;檢視 / 編輯頁要帶 id,由各頁自己的測試守),加上殼層路由的個人設定兩個分頁 ——
 * 新登記的頁只要在假世界裡有模組就自動納入。資料一律走假世界的 handlers,與 `pnpm dev:mock` 看到的是同一份。
 */
interface PageCase {
  readonly view: "root" | "tenant";
  readonly path: string;
}

const NEEDS_ID = /\.(view|edit)-page$/;

const moduleCases = (): PageCase[] => {
  const seen = new Set<string>();
  const cases: PageCase[] = [];
  // 租戶視角先:專案頁在根組織只顯示「請先切換機構」,要在租戶視角才看得到頁面本身
  for (const view of ["tenant", "root"] as const) {
    for (const module of mockModules(view)) {
      const { route } = module;
      if (
        route === null ||
        route === undefined ||
        !(module.key in modulePages) ||
        NEEDS_ID.test(module.key) ||
        seen.has(route)
      ) {
        continue;
      }
      seen.add(route);
      cases.push({ view, path: route });
    }
  }
  return cases;
};

const CASES: PageCase[] = [
  ...moduleCases(),
  { view: "tenant", path: `${PERSONAL_SETTINGS_PATH}?tab=preferences` },
  { view: "tenant", path: `${PERSONAL_SETTINGS_PATH}?tab=delegations` },
];

/** 手機寬與平板寬(`md` 起)各驗一次頁面根的宣告。 */
const MOBILE_WIDTH = 390;
const TABLET_WIDTH = 1024;

/**
 * 列表頁(`LIST_PAGE_SHELL_SX`:平板以上釘高、表格在卡片裡捲,手機寬整頁捲)。
 * 這份清單是決定本身:新列表頁要用列表頁殼就加進來;表單、設定、看板、個人設定等內容頁不在這裡(整頁捲)。
 */
const LIST_PAGES = new Set([
  "/apply-center",
  "/system/printers",
  "/system/workflows/blocked-page",
  "/accounts",
  "/dealers",
  "/inventory",
  "/master-data",
  "/purchasing/requisition",
  "/purchasing/purchase",
  "/purchasing/transfer",
  // 示範模組與表單模組的預設列表頁(`DemoListPage`、`FormListPage`)
  "/demo/sample-two",
  "/demo/sub/sample-one",
  "/demo-form",
  "/demo/form",
]);

/**
 * 分頁混著列表與內容的頁(店面管理、班表),標成列表分頁的那幾頁(`isList`;`<路徑>#<分頁名>`)。
 */
const LIST_TABS = new Set([
  "/store#班次結帳歷史紀錄",
  "/store#盤點紀錄",
  "/store#兌獎紀錄",
  "/store#其他申請",
  "/schedule/manage#支援需求單",
  "/schedule/settings#排班人員",
  "/schedule/settings#人力需求範本",
  "/schedule/settings#人力需求週範本",
]);

/**
 * 列表頁在平板寬時,目前這一頁的表格(依內容長高的表格則是包住它的捲動區塊):高度鏈從表格容器經 `min-height: 0` 一路接到 `<main>`、
 * 中間沒有多開的捲動層(超出量由表格容器吃掉),表頭固定。回傳問題描述(沒問題是空陣列)。
 */
const listTableProblems = (root: HTMLElement, label: string): string[] => {
  const table = root.querySelector("table");
  if (table === null) {
    return [`${label}:找不到表格`];
  }
  // 表格依內容長高(containerSx height auto)的分頁:捲動交給外面那一層區塊(例:兩張表的採購清單),
  // 高度鏈從那一層算;表格容器自己不捲,表頭也就不必固定
  const container = table.closest<HTMLElement>(".MuiTableContainer-root");
  const fitsContent =
    container?.parentElement != null &&
    globalThis.getComputedStyle(container).height === "auto";
  const chain = heightChainOf(fitsContent ? container.parentElement : table);
  const problems: string[] = [];
  if (chain.at(-1)?.label !== "MAIN.MuiBox-root") {
    problems.push(`${label}:高度鏈沒有接到 <main>`);
  }
  const loose = chain.filter((link) => link.minHeight !== "0");
  if (loose.length > 0) {
    problems.push(
      `${label}:這幾層沒有 min-height: 0,表格吃不掉超出量 → ${loose.map((link) => link.label).join(", ")}`,
    );
  }
  const extra = chain.slice(1, -1).filter((link) => link.scrolls);
  if (extra.length > 0) {
    problems.push(
      `${label}:多開一層捲動 → ${extra.map((link) => link.label).join(", ")}`,
    );
  }
  if (fitsContent) {
    return problems;
  }
  const looseHeaders = [...table.querySelectorAll("thead th")].filter(
    (cell) => !cell.classList.contains("MuiTableCell-stickyHeader"),
  );
  if (looseHeaders.length > 0) {
    problems.push(`${label}:表頭沒有固定(stickyHeader)`);
  }
  return problems;
};

describe("殼內頁面的頁面根不被壓扁(STYLE-08)", () => {
  it("清單涵蓋個人設定與專案、底座的列表頁(防清單悄悄變空)", () => {
    const paths = CASES.map((pageCase) => pageCase.path);
    expect(paths).toContain(`${PERSONAL_SETTINGS_PATH}?tab=preferences`);
    expect(paths).toContain("/overview");
    expect(paths.length).toBeGreaterThan(20);
  });

  it.each(CASES)("$view $path", async ({ view, path }) => {
    server.use(...mockHandlers({ view, authenticated: true }));
    const { user } = renderApp({ path });
    const content = await screen.findByTestId("shell-content");
    const settled = () => {
      expect(content.firstElementChild).not.toBeNull();
      expect(within(content).queryAllByRole("progressbar")).toEqual([]);
    };
    // 等頁面渲染完成(懶載入與第一批查詢):內容區有子層、而且沒有載入中的轉圈;
    // 表單模組的新增頁沒帶表單時先跳「選表單」對話框(內容區是空的)→ 選第一張,驗真正的新增頁
    await waitFor(() => {
      if (screen.queryByRole("dialog") === null) {
        settled();
      }
    });
    const picker = screen.queryByRole("dialog");
    if (picker !== null && content.firstElementChild === null) {
      const options = within(within(picker).getByRole("list")).getAllByRole(
        "button",
      );
      await user.click(options[0]);
    }
    await waitFor(settled);
    const root = content.firstElementChild;
    if (!(root instanceof HTMLElement)) {
      throw new TypeError("頁面根不是 HTML 元素");
    }
    expect(squeezedPageRootProblem(root, MOBILE_WIDTH)).toBeNull();
    expect(squeezedPageRootProblem(root, TABLET_WIDTH)).toBeNull();
    const [bare = path] = path.split("?", 1);
    expect(TABLET_WIDTH).toBeGreaterThanOrEqual(LIST_PIN_MIN_WIDTH);
    // 有分頁的頁:逐一點每個分頁,列表分頁(LIST_PAGES 的整頁、LIST_TABS 的單一分頁)在平板寬由卡片裡那一層捲、
    // 表頭固定;其餘分頁整頁捲(頁殼不釘高也不被壓扁)
    const tablist = within(root).queryAllByRole("tablist").at(0);
    const tabs =
      tablist === undefined ? [] : within(tablist).getAllByRole("tab");
    const problems: string[] = [];
    const check = async (label: string) => {
      const expected = LIST_PAGES.has(bare) || LIST_TABS.has(label);
      if (expected) {
        await waitFor(() => {
          expect(root.querySelector("table")).not.toBeNull();
        });
      }
      if (isListPageShell(root) !== expected) {
        problems.push(
          `${label}:${expected ? "應該是" : "不應該是"}列表頁殼(平板以上釘高、手機寬整頁捲)`,
        );
      }
      for (const width of [MOBILE_WIDTH, TABLET_WIDTH]) {
        const problem = squeezedPageRootProblem(root, width);
        if (problem !== null) {
          problems.push(`${label}:${problem}`);
        }
      }
      if (expected) {
        problems.push(...listTableProblems(root, label));
      }
    };
    if (tabs.length === 0) {
      await check(bare);
    }
    for (const tab of tabs) {
      await user.click(tab);
      await waitFor(settled);
      await check(`${bare}#${tab.textContent}`);
    }
    expect(problems).toEqual([]);
  });
});
