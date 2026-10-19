import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { type TestModule, authWorld } from "@/test/msw/auth-handlers";
import { formsModules } from "@/test/msw/form-fixtures";
import { server } from "@/test/msw/server";

import {
  FORMS_ALL,
  defaultDesignOptions,
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const ROLE_MANAGER_ROUTE = "/system/role-manager";

const roleManagerModule: TestModule = {
  id: "m-role",
  key: "system.role-manager",
  name: "角色管理",
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 3,
  route: ROLE_MANAGER_ROUTE,
  icon: null,
  permissions: ["system.role-manager.view"],
};

const CREATED = {
  key: "demo-form.create-shopping_list",
  name: "購物單 新增",
};

/** 打開版本面板 → 發布 → 填變更說明送出。 */
const publish = async (user: ReturnType<typeof renderFormsPage>["user"]) => {
  await findDesigner();
  await user.click(screen.getByRole("tab", { name: "表單版本" }));
  const table = await screen.findByRole("table", { name: "版本清單" });
  await user.click(within(table).getByRole("button", { name: "發布" }));
  const dialog = await screen.findByRole("dialog", { name: "發布新版本" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "變更說明" }),
    "第二版",
  );
  await user.click(within(dialog).getByRole("button", { name: "發布" }));
};

describe("表單管理:發布新建了依表單新增權限", () => {
  it("發布成功提示「不會自動授予」並附 [前往角色管理] 連結", async () => {
    const { user } = renderFormsPage({
      ...defaultDesignOptions(),
      createdPermissions: { shopping_list: CREATED },
    });
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: [...formsModules(FORMS_ALL), roleManagerModule],
      }).handlers,
    );

    await publish(user);

    const granted = await screen.findByRole("dialog", { name: "發布成功" });
    expect(
      within(granted).getByText("「購物單」第 2 版已發布。"),
    ).toBeInTheDocument();
    expect(
      within(granted).getByText(
        "已建立權限「購物單 新增」,不會自動授予。請到角色管理授予需要的角色。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(granted).getByRole("button", { name: "前往角色管理" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        ROLE_MANAGER_ROUTE,
      );
    });
  });

  it("沒有角色管理權限:只有 [稍後],按了關掉提示", async () => {
    const { user } = renderFormsPage({
      ...defaultDesignOptions(),
      createdPermissions: { shopping_list: CREATED },
    });

    await publish(user);

    const granted = await screen.findByRole("dialog", { name: "發布成功" });
    expect(
      within(granted).queryByRole("button", { name: "前往角色管理" }),
    ).toBeNull();
    await user.click(within(granted).getByRole("button", { name: "稍後" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "發布成功" })).toBeNull();
    });
  });

  it("沒有新建權限(模組沒開或已存在):不出現提示,照舊只跳成功訊息", async () => {
    const { user } = renderFormsPage();

    await publish(user);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "發布新版本" })).toBeNull();
    });
    expect(screen.queryByRole("dialog", { name: "發布成功" })).toBeNull();
  });
});
