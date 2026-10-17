import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  APPLY_CENTER_ROUTE,
  APPLY_VIEW_ROUTE,
} from "@/test/msw/workflow-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntime,
  renderApplyCenter,
} from "../apply-center-test-support";

setupFakeViewport();

beforeAll(async () => {
  // 懶載入的頁面先載進模組快取(TEST-08)
  await import("./ApplyCenterPage");
  await import("../ApplyCenterViewPage/ApplyCenterViewPage");
});

const findSideNav = () => screen.findByRole("navigation", { name: "主選單" });

/** MUI 徽章沒有 role,只能用 class 取;回「看得到」的那些。 */
const visibleBadges = (element: HTMLElement) =>
  [...element.querySelectorAll(".MuiBadge-badge")].filter(
    (badge) => !badge.classList.contains("MuiBadge-invisible"),
  );

describe("申請中心的頁籤 badge 與側欄待審數(applyCenterCounts)", () => {
  it("頁籤:我的申請 = 進行中筆數、待我審核 = 待處理任務數;側欄申請中心 = 待審數", async () => {
    renderApplyCenter({ path: APPLY_CENTER_ROUTE });

    const tasksTab = await screen.findByRole("tab", {
      name: "待我審核(待處理 1 筆)",
    });
    expect(visibleBadges(tasksTab).map((badge) => badge.textContent)).toEqual([
      "1",
    ]);
    const mineTab = screen.getByRole("tab", {
      name: "我的申請(進行中 1 筆)",
    });
    expect(visibleBadges(mineTab).map((badge) => badge.textContent)).toEqual([
      "1",
    ]);
    const nav = await findSideNav();
    expect(
      within(nav).getByRole("link", { name: /申請中心\s*1 筆待處理/ }),
    ).toBeInTheDocument();
  });

  it("0 不顯示:沒有待處理任務、沒有進行中的申請時,頁籤與側欄都沒有徽章", async () => {
    const { runtime } = renderApplyCenter({
      path: APPLY_CENTER_ROUTE,
      runtime: { ...defaultRuntime(), tasks: [], applications: [] },
    });
    await waitFor(() => {
      expect(runtime.countsCalls()).toBeGreaterThan(0);
    });

    const tasksTab = await screen.findByRole("tab", { name: "待我審核" });
    const mineTab = screen.getByRole("tab", { name: "我的申請" });
    expect(visibleBadges(tasksTab)).toEqual([]);
    expect(visibleBadges(mineTab)).toEqual([]);
    const nav = await findSideNav();
    expect(within(nav).getByRole("link", { name: "申請中心" })).toBeVisible();
    expect(visibleBadges(nav)).toEqual([]);
  });

  it("超過 99 顯示 99+(頁籤與側欄都是)", async () => {
    renderApplyCenter({
      path: APPLY_CENTER_ROUTE,
      runtime: {
        ...defaultRuntime(),
        counts: { myTasks: 120, myApplications: 3 },
      },
    });

    const tasksTab = await screen.findByRole("tab", {
      name: "待我審核(待處理 120 筆)",
    });
    expect(within(tasksTab).getByText("99+")).toBeInTheDocument();
    const nav = await findSideNav();
    expect(within(nav).getByText("99+")).toBeInTheDocument();
  });

  it("切頁籤時重取一次", async () => {
    const { user, runtime } = renderApplyCenter({ path: APPLY_CENTER_ROUTE });
    await screen.findByRole("tab", { name: "待我審核(待處理 1 筆)" });
    const before = runtime.countsCalls();

    await user.click(screen.getByRole("tab", { name: /^待我審核/ }));

    await waitFor(() => {
      expect(runtime.countsCalls()).toBeGreaterThan(before);
    });
  });

  it("核准一筆後待審數減一:側欄的數字跟著消失", async () => {
    const { user } = renderApplyCenter({ path: `${APPLY_VIEW_ROUTE}/inst-1` });
    const nav = await findSideNav();
    expect(
      await within(nav).findByRole("link", { name: /申請中心\s*1 筆待處理/ }),
    ).toBeInTheDocument();

    const actions = await screen.findByRole("group", {
      name: "我在「直屬主管」的審核",
    });
    await user.click(within(actions).getByRole("button", { name: "核准" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "核准「直屬主管」" }),
      ).getByRole("button", { name: "核准" }),
    );

    expect(
      await within(nav).findByRole("link", { name: "申請中心" }),
    ).toBeInTheDocument();
  });

  it("側欄收合時只畫小圓點(沒有數字)", async () => {
    const { user } = renderApplyCenter({ path: APPLY_CENTER_ROUTE });
    const nav = await findSideNav();
    await within(nav).findByRole("link", { name: /1 筆待處理/ });

    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));

    const rail = within(nav).getByRole("link", { name: "申請中心" });
    const dots = visibleBadges(rail);
    expect(dots).toHaveLength(1);
    expect(dots.every((dot) => dot.classList.contains("MuiBadge-dot"))).toBe(
      true,
    );
    expect(dots.map((dot) => dot.textContent)).toEqual([""]);
  });
});
