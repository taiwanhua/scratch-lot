import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { PERSONAL_SETTINGS_PATH } from "@/lib/base/paths";
import { mockHandlers, mockModules } from "@/mock/mock-world";
import { squeezedPageRootProblem } from "@/test/height-chain";
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
    expect(squeezedPageRootProblem(root)).toBeNull();
  });
});
