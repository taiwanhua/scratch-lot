import { screen } from "@testing-library/react";
import { HttpResponse } from "msw";
import { createElement } from "react";

import { authWorld } from "@/test/msw/auth-handlers";
import type { TestOrgNode } from "@/test/msw/org-manager-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import {
  OrgTreeSelectHarness,
  type OrgTreeSelectHarnessProps,
} from "./OrgTreeSelectHarness";

/** OrgTreeSelect 元件測試的共用夾具與操作(TEST-08:測試檔只寫行為) */

type OrgTreeResolver = Parameters<typeof api.query>[1];

/** 形狀同 api 的 `orgTree`(樹根 `parentId` 為 null、葉節點 `children: []`,TEST-12) */
export const node = (
  id: string,
  name: string,
  parentId: string | null,
  overrides: Partial<TestOrgNode> = {},
): TestOrgNode => ({
  id,
  name,
  parentId,
  enabled: true,
  outOfScope: false,
  ownerUserId: null,
  children: [],
  ...overrides,
});

/** Figma Draft/OrgTreeSelect 的示範樹:示範公司 > 北區(A 店、B 店)、南區(C 店) */
export const demoTree: TestOrgNode[] = [
  node("org-co", "示範公司", null, {
    ownerUserId: "user-owner",
    children: [
      node("org-north", "北區", "org-co", {
        children: [
          node("org-a", "A 店", "org-north"),
          node("org-b", "B 店", "org-north"),
        ],
      }),
      node("org-south", "南區", "org-co", {
        children: [node("org-c", "C 店", "org-south")],
      }),
    ],
  }),
];

/**
 * 渲染受控外殼;`orgTree` 給陣列就回那棵樹,給 handler 就整個換掉(載入中 / 失敗)。
 */
export const renderSelect = (
  props: OrgTreeSelectHarnessProps = {},
  orgTree: TestOrgNode[] | OrgTreeResolver = demoTree,
) => {
  server.use(
    ...authWorld({ hasRefreshCookie: true }).handlers,
    api.query(
      "OrgTree",
      Array.isArray(orgTree)
        ? () => HttpResponse.json({ data: { orgTree } })
        : orgTree,
    ),
  );
  return renderApp({
    path: "/overview",
    extra: createElement(OrgTreeSelectHarness, props),
  });
};

export type User = ReturnType<typeof renderSelect>["user"];

export const field = () => screen.getByRole("combobox", { name: "組織" });
export const valueText = () => screen.getByTestId("value").textContent;

/** 打開面板,回傳搜尋框 */
export const openPanel = async (user: User) => {
  await user.click(field());
  return screen.findByRole("textbox", { name: "搜尋組織" });
};

/** 欄位外框(多選的標籤在裡面);面板開著時欄位被 modal 標成 aria-hidden,所以帶 `hidden` */
export const fieldRoot = (): HTMLElement => {
  const root = screen
    .getByRole("combobox", { name: "組織", hidden: true })
    .closest<HTMLElement>(".MuiInputBase-root");
  if (root === null) {
    throw new Error("找不到欄位外框");
  }
  return root;
};

export const rowOf = (label: string): HTMLElement => {
  const row = screen
    .getAllByRole("treeitem")
    .find((item) => item.textContent.startsWith(label));
  if (row === undefined) {
    throw new Error(`找不到「${label}」這一列`);
  }
  return row;
};

/** 某一列自己的勾選框(DOM 上是該列的第一個 input) */
export const checkboxOf = (label: string): HTMLInputElement => {
  const box = rowOf(label).querySelector<HTMLInputElement>(
    "input[type='checkbox']",
  );
  if (box === null) {
    throw new Error(`「${label}」這一列沒有勾選框`);
  }
  return box;
};

export const treeLabels = () =>
  screen
    .getAllByRole("treeitem")
    .map((item) => item.querySelector(".MuiTreeItem-label")?.textContent);
