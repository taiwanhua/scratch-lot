import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { Button } from "@repo/ui/button";

import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { type PageTabItem, PageTabs } from "./PageTabs";

/** 測試使用者:總覽模組的 `overview.*`(所以 `overview.*` 底下的權限都算有),沒有稽核權限。 */
const modules: TestModule[] = [overviewModule];

const item = (
  value: string,
  label: string,
  permission?: string,
): PageTabItem => ({
  value,
  label,
  permission,
  content: <p>{`${label}的內容`}</p>,
});

const renderTabs = (url: string, items: readonly PageTabItem[]) => {
  server.use(...authWorld({ hasRefreshCookie: true, modules }).handlers);
  // nuqs 的 react-router adapter 讀 `window.location`;MemoryRouter 的起點由 renderApp 給
  globalThis.history.replaceState(null, "", url);
  return renderApp({
    path: url,
    extra: (
      <PageTabs
        aria-label="測試分頁"
        items={items}
        actions={<Button>新申請</Button>}
      />
    ),
  });
};

const tabSearch = () =>
  new URLSearchParams(
    screen.getByTestId("location").textContent.split("?", 2)[1] ?? "",
  ).get("tab");

afterEach(() => {
  globalThis.history.replaceState(null, "", "/");
});

describe("PageTabs", () => {
  it("目前分頁記在網址:點分頁 → ?tab=<value>;從網址打開 → 停在那一頁", async () => {
    const { user } = renderTabs("/overview", [
      item("mine", "我的申請"),
      item("tasks", "待我審核"),
    ]);

    const tablist = await screen.findByRole("tablist", { name: "測試分頁" });
    expect(
      within(tablist).getByRole("tab", { name: "我的申請" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("我的申請的內容")).toBeInTheDocument();

    await user.click(within(tablist).getByRole("tab", { name: "待我審核" }));

    expect(await screen.findByText("待我審核的內容")).toBeInTheDocument();
    expect(screen.queryByText("我的申請的內容")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(tabSearch()).toBe("tasks");
    });
  });

  it("內容區是 role=tabpanel,與選中的 tab 以 aria-controls / aria-labelledby 互相關聯", async () => {
    const { user } = renderTabs("/overview", [
      item("mine", "我的申請"),
      item("tasks", "待我審核"),
    ]);

    const panel = await screen.findByRole("tabpanel", { name: "我的申請" });
    expect(panel).toHaveTextContent("我的申請的內容");
    const tab = screen.getByRole("tab", { name: "我的申請" });
    expect(tab).toHaveAttribute("aria-controls", panel.id);

    await user.click(screen.getByRole("tab", { name: "待我審核" }));

    const next = await screen.findByRole("tabpanel", { name: "待我審核" });
    expect(next).toHaveTextContent("待我審核的內容");
    expect(screen.getByRole("tab", { name: "待我審核" })).toHaveAttribute(
      "aria-controls",
      next.id,
    );
  });

  it("只剩一個分頁時沒有分頁籤,也就沒有 tabpanel", async () => {
    renderTabs("/overview", [
      item("mine", "我的申請"),
      item("audit", "稽核", "system.audit.view"),
    ]);

    expect(await screen.findByText("我的申請的內容")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  it("網址的分頁不存在(被改壞)→ 退回第一個分頁,不報錯", async () => {
    renderTabs("/overview?tab=nope", [
      item("mine", "我的申請"),
      item("tasks", "待我審核"),
    ]);

    expect(
      await screen.findByRole("tab", { name: "我的申請", selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByText("我的申請的內容")).toBeInTheDocument();
  });

  it("沒權限的分頁不顯示;網址指到它也進不去", async () => {
    renderTabs("/overview?tab=audit", [
      item("mine", "我的申請", "overview.view"),
      item("tasks", "待我審核"),
      item("audit", "稽核", "system.audit.view"),
    ]);

    const tablist = await screen.findByRole("tablist", { name: "測試分頁" });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["我的申請", "待我審核"]);
    expect(screen.queryByText("稽核的內容")).not.toBeInTheDocument();
    expect(screen.getByText("我的申請的內容")).toBeInTheDocument();
  });

  it("只剩一個分頁 → 不顯示分頁籤,直接顯示內容;右側動作仍在", async () => {
    renderTabs("/overview", [
      item("mine", "我的申請"),
      item("audit", "稽核", "system.audit.view"),
    ]);

    expect(await screen.findByText("我的申請的內容")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新申請" })).toBeInTheDocument();
  });

  it("一個分頁都看不到 → 整個不渲染", async () => {
    renderTabs("/overview", [item("audit", "稽核", "system.audit.view")]);

    // 殼在 `me` 載完後才渲染:看到側欄的模組名 = 權限已知
    const shellLabels = await screen.findAllByText("總覽");
    expect(shellLabels.length).toBeGreaterThan(0);
    expect(screen.queryByText("稽核的內容")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新申請" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * 「放不下 → 選到的分頁捲進可視範圍」:jsdom 沒有版面,這裡給分頁列一個假幾何 ——
 * 捲動容器寬 300px,每個分頁寬 100px 依序排開,位置隨容器的 scrollLeft 移動。
 * 捲動是 `@repo/ui/tabs` 的 `scrollable`(MUI 的 scrollSelectedIntoView)做的,這裡驗 PageTabs 有開它、
 * 而且從網址打開時也算「選到」。
 */
/* eslint-disable unicorn/no-this-outside-of-class, @typescript-eslint/unbound-method -- 假幾何得掛在 DOM 原型的 getter / 方法上,只能用 this 認出是哪個元素;原值存起來、測完原樣還回去 */
describe("PageTabs 放不下時", () => {
  const SCROLLER_WIDTH = 300;
  const TAB_WIDTH = 100;
  const scrollLefts = new WeakMap<Element, number>();
  const original = {
    rect: Element.prototype.getBoundingClientRect,
    scrollLeft: Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollLeft",
    ),
    clientWidth: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    ),
  };

  const isScroller = (element: Element) =>
    element.classList.contains("MuiTabs-scroller");

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollLeft", {
      configurable: true,
      get(this: Element) {
        return scrollLefts.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        scrollLefts.set(this, value);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? SCROLLER_WIDTH : 0;
      },
    });
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (isScroller(this)) {
        return DOMRect.fromRect({
          x: 0,
          y: 0,
          width: SCROLLER_WIDTH,
          height: 40,
        });
      }
      const scroller = this.closest(".MuiTabs-scroller");
      if (this.getAttribute("role") === "tab" && scroller) {
        const index = [...scroller.querySelectorAll('[role="tab"]')].indexOf(
          this,
        );
        return DOMRect.fromRect({
          x: index * TAB_WIDTH - scroller.scrollLeft,
          y: 0,
          width: TAB_WIDTH,
          height: 40,
        });
      }
      return DOMRect.fromRect();
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = original.rect;
    if (original.scrollLeft) {
      Object.defineProperty(
        Element.prototype,
        "scrollLeft",
        original.scrollLeft,
      );
    }
    if (original.clientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        original.clientWidth,
      );
    }
  });

  it("從網址打開第 6 個分頁 → 分頁列捲到它整個看得見", async () => {
    const labels = [
      "基本資料",
      "聯絡資訊",
      "合約",
      "附件",
      "審核紀錄",
      "修訂紀錄",
    ];
    renderTabs(
      "/overview?tab=t5",
      labels.map((label, index) => item(`t${String(index)}`, label)),
    );

    const selected = await screen.findByRole("tab", {
      name: "修訂紀錄",
      selected: true,
    });
    const scroller = selected.closest(".MuiTabs-scroller");
    // 單列橫向捲動的容器(`@repo/ui/tabs` 的 scrollable),不是換行或擠壓
    expect(scroller).toHaveClass("MuiTabs-scrollableX");

    // 第 6 個分頁在 500–600px;容器 300px 寬 → 至少要捲 300px,右緣才進得來
    await waitFor(() => {
      expect(scroller?.scrollLeft).toBeGreaterThanOrEqual(
        6 * TAB_WIDTH - SCROLLER_WIDTH,
      );
    });
    const rect = selected.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(SCROLLER_WIDTH);
  });

  it("從網址打開第 1 個分頁 → 不捲動", async () => {
    renderTabs(
      "/overview?tab=t0",
      ["基本資料", "聯絡資訊", "合約", "附件", "審核紀錄", "修訂紀錄"].map(
        (label, index) => item(`t${String(index)}`, label),
      ),
    );

    const selected = await screen.findByRole("tab", {
      name: "基本資料",
      selected: true,
    });
    expect(selected.closest(".MuiTabs-scroller")?.scrollLeft).toBe(0);
  });
});
/* eslint-enable unicorn/no-this-outside-of-class, @typescript-eslint/unbound-method */
