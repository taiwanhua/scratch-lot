import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";
import { HttpResponse } from "msw";
import { createElement } from "react";

import { demoTree } from "@/components/base/OrgTreeSelect/org-tree-select-test-support";
import { authWorld } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import { renderApp } from "@/test/render";

import { ShareOrgsField, type ShareOrgsFieldProps } from "./ShareOrgsField";

const renderField = (props: Partial<ShareOrgsFieldProps> = {}) => {
  server.use(
    ...authWorld({ hasRefreshCookie: true }).handlers,
    api.query("TenantOrgTree", () =>
      HttpResponse.json({
        data: {
          tenantOrgTree: toTenantTree(demoTree, {
            visibleIds: [],
            managedIds: [],
          }),
        },
      }),
    ),
  );
  return renderApp({
    path: "/overview",
    extra: createElement(ShareOrgsField, {
      label: "共用給",
      value: [],
      onChange: () => {
        // 只看外框尺寸
      },
      ...props,
    }),
  });
};

const fieldRoot = (): HTMLElement => {
  const root = screen
    .getByRole("combobox", { name: "共用給" })
    .closest<HTMLElement>(".MuiInputBase-root");
  if (root === null) {
    throw new Error("找不到欄位外框");
  }
  return root;
};

describe("ShareOrgsField", () => {
  it("高度跟 TextField 同一組 size:不給是 medium,給 small 才是 small", () => {
    const { unmount } = renderField();
    expect(fieldRoot()).not.toHaveClass("MuiInputBase-sizeSmall");
    unmount();

    renderField({ size: "small" });
    expect(fieldRoot()).toHaveClass("MuiInputBase-sizeSmall");
  });
});
