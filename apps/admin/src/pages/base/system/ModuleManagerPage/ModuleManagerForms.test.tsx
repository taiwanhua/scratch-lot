import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  FormVersionStatus,
  ModuleEngine,
  ModuleListColumnKind,
  ModuleSidebarType,
} from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import { formDesignWorld } from "@/test/msw/form-design-handlers";
import {
  SHOPPING_FORM_KEY,
  formFragment,
  shoppingDefinition,
  versionFragment,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { moduleAdminTree } from "@/test/msw/module-admin-fixtures";
import {
  type TestModuleAdminNode,
  moduleAdminWorld,
} from "@/test/msw/module-manager-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { currentSearch, urlParam } from "@/test/url-reload";

import { MODULE_MANAGER_PERMISSIONS } from "./module-manager-permissions";
import {
  FULL_PERMISSIONS,
  clickNode,
  detail,
  modulesWith,
  waitForTree,
} from "./module-manager-test-support";

const shoppingNode: TestModuleAdminNode = {
  id: "m-demo-form",
  key: "demo-form",
  name: "示範表單(頂層)",
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  route: "demo-form",
  order: 3,
  description: null,
  icon: null,
  enabled: true,
  engine: ModuleEngine.Form,
  permissions: [],
  children: [],
};

const usage = (drafts: number, completed: number) => ({
  draftCount: drafts,
  draftVersions: drafts > 0 ? [2] : [],
  completedCount: completed,
  completedVersions: completed > 0 ? [1] : [],
});

const retiredPermission = (
  fieldKey: string,
  name: string,
  drafts: number,
  completed: number,
) => ({
  key: `demo-form.show-shopping_list-${fieldKey}`,
  name,
  moduleKey: "demo-form",
  formKey: SHOPPING_FORM_KEY,
  formName: "購物單",
  fieldKey,
  action: "show",
  retiredAt: "2026-09-21T00:00:00.000Z",
  usage: usage(drafts, completed),
});

const render = (permissions: readonly string[], search = "") => {
  const design = formDesignWorld({
    forms: [formFragment()],
    versions: {
      [SHOPPING_FORM_KEY]: [
        versionFragment(shoppingDefinition(), {
          version: 1,
          status: FormVersionStatus.Published,
        }),
      ],
    },
    retired: [
      retiredPermission("old_price", "購物單 / 舊單價 可見", 1, 3),
      retiredPermission("old_note", "購物單 / 舊備註 可見", 0, 2),
      // 沒人用:api 直接刪(retiredOutcomes 沒列)
      retiredPermission("old_tag", "購物單 / 舊標籤 可見", 0, 0),
    ],
    retiredOutcomes: {
      "demo-form.show-shopping_list-old_price": {
        code: "PERMISSION_NOT_DELETABLE",
        extensions: { reasons: ["USED_BY_DRAFTS"], usage: usage(1, 3) },
      },
      "demo-form.show-shopping_list-old_note": {
        code: "PERMISSION_NOT_DELETABLE",
        extensions: { reasons: ["CONFIRM_REQUIRED"], usage: usage(0, 2) },
      },
    },
  });
  server.use(
    ...moduleAdminWorld({ tree: [...moduleAdminTree, shoppingNode] }).handlers,
    ...design.handlers,
    ...formRuntimeWorld({
      versions: { [`${SHOPPING_FORM_KEY}@1`]: shoppingDefinition() },
    }).handlers,
    ...authWorld({ hasRefreshCookie: true, modules: modulesWith(permissions) })
      .handlers,
  );
  return {
    ...renderApp({ path: `/system/module-manager${search}` }),
    design,
  };
};

describe("模組與權限:表單模組的列表欄位配置、退役權限清理", () => {
  it("退役權限清理:草稿還在用 → 擋下並列出筆數;只剩已完成 → 警告確認後才刪", async () => {
    const { user, design } = render([
      ...FULL_PERMISSIONS,
      MODULE_MANAGER_PERMISSIONS.deleteRetiredPermission,
    ]);
    await waitForTree();

    await user.click(screen.getByRole("button", { name: "退役權限清理" }));
    const dialog = await screen.findByRole("dialog", { name: "退役權限清理" });
    await within(dialog).findByText("購物單 / 舊單價 可見");

    await user.click(
      within(dialog).getByRole("button", {
        name: "刪除權限「購物單 / 舊單價 可見」",
      }),
    );
    expect(
      await within(dialog).findByText(
        /還有 1 筆草稿\(v2\)用到「購物單 \/ 舊單價 可見」,不能刪除/,
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", {
        name: "刪除權限「購物單 / 舊備註 可見」",
      }),
    );
    expect(
      await within(dialog).findByText(/只有超級管理員看得到/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "確認刪除" }));

    await waitFor(() => {
      expect(design.inputs.deleteRetiredPermission).toHaveLength(3);
    });
    expect(design.inputs.deleteRetiredPermission[2]).toEqual({
      permissionKey: "demo-form.show-shopping_list-old_note",
      confirmCompletedUsage: true,
    });
    await waitFor(() => {
      expect(within(dialog).queryByText("購物單 / 舊備註 可見")).toBeNull();
    });
  });

  it("退役權限清理:沒人用 → 直接刪,不跳確認", async () => {
    const { user, design } = render([
      ...FULL_PERMISSIONS,
      MODULE_MANAGER_PERMISSIONS.deleteRetiredPermission,
    ]);
    await waitForTree();

    await user.click(screen.getByRole("button", { name: "退役權限清理" }));
    const dialog = await screen.findByRole("dialog", { name: "退役權限清理" });
    await within(dialog).findByText("購物單 / 舊標籤 可見");
    await user.click(
      within(dialog).getByRole("button", {
        name: "刪除權限「購物單 / 舊標籤 可見」",
      }),
    );

    await waitFor(() => {
      expect(within(dialog).queryByText("購物單 / 舊標籤 可見")).toBeNull();
    });
    expect(design.inputs.deleteRetiredPermission).toEqual([
      { permissionKey: "demo-form.show-shopping_list-old_tag" },
    ]);
    expect(
      within(dialog).queryByRole("button", { name: "確認刪除" }),
    ).toBeNull();
    // 其餘兩筆還在
    expect(
      within(dialog).getByText("購物單 / 舊單價 可見"),
    ).toBeInTheDocument();
  });

  it("沒有 delete-retired-permission:看得到清單、沒有刪除鈕", async () => {
    const { user } = render(FULL_PERMISSIONS);
    await waitForTree();

    await user.click(screen.getByRole("button", { name: "退役權限清理" }));
    const dialog = await screen.findByRole("dialog", { name: "退役權限清理" });
    await within(dialog).findByText("購物單 / 舊單價 可見");
    expect(
      within(dialog).queryByRole("button", { name: /刪除權限/ }),
    ).toBeNull();
  });

  it("列表欄位配置:表單模組才有這一列;加一欄表單欄位存檔整份覆蓋", async () => {
    const { user, design } = render([...FULL_PERMISSIONS, "system.forms.edit"]);
    await waitForTree();

    await clickNode(user, "示範表單(頂層)");
    await user.click(
      await within(detail()).findByRole("button", { name: "設定列表欄位" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "列表欄位配置 — 示範表單(頂層)",
    });
    await within(dialog).findByText(
      "目前沒有設定,列表使用預設欄(標題、日期)。",
    );

    await user.click(within(dialog).getByRole("button", { name: "+ 摘要槽" }));
    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "+ 表單欄位" }),
      ).toBeEnabled();
    });
    await user.click(
      within(dialog).getByRole("button", { name: "+ 表單欄位" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(design.inputs.setModuleListColumns).toHaveLength(1);
    });
    expect(design.inputs.setModuleListColumns[0]).toEqual({
      moduleKey: "demo-form",
      columns: [
        { kind: ModuleListColumnKind.Slot, key: "title", width: 180, order: 0 },
        {
          kind: ModuleListColumnKind.Field,
          key: "item",
          formKey: SHOPPING_FORM_KEY,
          width: 180,
          order: 1,
        },
      ],
      builtin: { form: true, status: true, createdBy: true },
    });
  });

  it("引擎:模組連結標出表單引擎或固定欄位;群組、隱藏頁、權限容器不顯示這一列", async () => {
    const { user } = render(FULL_PERMISSIONS);
    await waitForTree();

    const engineOf = async (name: string) => {
      await clickNode(user, name);
      await within(detail()).findByText(name);
      return within(detail()).queryByText("引擎")?.nextElementSibling
        ?.textContent;
    };

    expect(await engineOf(shoppingNode.name)).toBe("表單引擎");
    expect(await engineOf("使用者管理")).toBe("固定欄位");
    expect(await engineOf("系統管理")).toBeUndefined();
    expect(await engineOf("編輯")).toBeUndefined();
    expect(await engineOf("API 能力")).toBeUndefined();
  });

  it("退役權限清單是唯讀的檢視彈窗:開著記在網址 `?dialog=retired`,重新整理還開著;關掉就拿掉", async () => {
    const first = render(FULL_PERMISSIONS);
    await waitForTree();
    await first.user.click(
      screen.getByRole("button", { name: "退役權限清理" }),
    );
    await screen.findByRole("dialog", { name: "退役權限清理" });
    await waitFor(() => {
      expect(urlParam("dialog")).toBe("retired");
    });
    first.unmount();

    const second = render(FULL_PERMISSIONS, currentSearch());
    const dialog = await screen.findByRole("dialog", { name: "退役權限清理" });
    expect(
      await within(dialog).findByText("購物單 / 舊單價 可見"),
    ).toBeInTheDocument();

    await second.user.click(
      within(dialog).getByRole("button", { name: "關閉" }),
    );
    await waitFor(() => {
      expect(urlParam("dialog")).toBeNull();
    });
  });
});
