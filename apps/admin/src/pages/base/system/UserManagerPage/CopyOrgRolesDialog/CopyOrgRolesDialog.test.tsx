import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { CopyUserOrgRolesBlockerCode } from "@repo/graphql";

import { autocompleteOption, openAutocomplete } from "@/test/autocomplete";
import { graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { findSnackbarAlert, querySnackbar } from "@/test/snackbar";

import { USER_MANAGER_PERMISSIONS } from "../user-manager-permissions";
import {
  ALL_PERMISSIONS,
  defaultUsers,
  renderPage,
  rowOf,
} from "../user-manager-test-support";

const ACTION = "複製組織與角色";

type Actor = ReturnType<typeof renderPage>["user"];

/** 從某一列打開「複製組織與角色」彈窗。 */
const openCopyDialog = async (actor: Actor, sourceName: string) => {
  await screen.findByText(sourceName);
  await actor.click(
    within(rowOf(sourceName)).getByRole("button", { name: ACTION }),
  );
  return screen.findByRole("dialog");
};

/** 在彈窗的目標欄選一位使用者(選項主文字是「姓名(帳號)」)。 */
const pickTarget = async (actor: Actor, name: string) => {
  await openAutocomplete(actor, "目標使用者");
  await actor.click(await waitFor(() => autocompleteOption(name)));
};

/**
 * 複製組織與角色(使用者管理的列動作 → 單一彈窗;MSW 的假伺服器依夾具算合併 / 取代的差異,
 * 正式送出會改寫目標那一筆,重查清單看得到新值)。
 * 夾具:王小明屬「租戶 A」「內容組」,持「編輯」「審核員」;何家華屬「租戶 A」,持「租戶管理員」。
 */
describe("複製組織與角色", () => {
  it("有 view + manage-orgs + assign-roles 三個權限才出現列動作", async () => {
    renderPage();

    await screen.findByText("王小明");

    expect(
      within(rowOf("王小明")).getByRole("button", { name: ACTION }),
    ).toBeInTheDocument();
  });

  it.each([
    USER_MANAGER_PERMISSIONS.manageOrgs,
    USER_MANAGER_PERMISSIONS.assignRoles,
  ])("少了 %s 就不出現列動作", async (missing) => {
    renderPage({
      permissions: ALL_PERMISSIONS.filter((key) => key !== missing),
    });

    await screen.findByText("王小明");

    expect(
      within(rowOf("王小明")).queryByRole("button", { name: ACTION }),
    ).toBeNull();
  });

  it("目標的候選不含操作者自己(小華 = 登入者)", async () => {
    const { user: actor } = renderPage();
    await openCopyDialog(actor, "王小明");

    const options = await openAutocomplete(actor, "目標使用者");

    expect(options.some((option) => option.textContent.includes("小華"))).toBe(
      false,
    );
  });

  it("停用的使用者也可以選為目標(allowDisabled)", async () => {
    const template = defaultUsers[0];
    const { user: actor } = renderPage({
      world: {
        users: [
          ...defaultUsers,
          {
            ...template,
            id: "user-off",
            account: "user-off",
            name: "停用的人",
            enabled: false,
            roles: [],
          },
        ],
      },
    });
    const dialog = await openCopyDialog(actor, "王小明");

    await pickTarget(actor, "停用的人");

    expect(await within(dialog).findByText("新增:內容組")).toBeInTheDocument();
  });

  it("預覽失敗:就地顯示原因、不再顯示「計算中」、不跳提示", async () => {
    const { user: actor } = renderPage();
    server.use(
      api.mutation("CopyUserOrgRoles", () => graphqlError("FORBIDDEN")),
    );
    const dialog = await openCopyDialog(actor, "王小明");

    await pickTarget(actor, "何家華");

    expect(
      await within(dialog).findByText("你沒有執行這個動作的權限。"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("正在計算變更…")).toBeNull();
    expect(querySnackbar()).toBeNull();
  });

  it("目標的候選不含來源本人", async () => {
    const { user: actor } = renderPage();
    await openCopyDialog(actor, "王小明");

    const options = await openAutocomplete(actor, "目標使用者");

    expect(
      options.some((option) => option.textContent.includes("王小明")),
    ).toBe(false);
    expect(
      options.some((option) => option.textContent.includes("何家華")),
    ).toBe(true);
  });

  it("選目標後以合併預覽:列出新增與保留,角色附擁有組織", async () => {
    const { user: actor } = renderPage();
    const dialog = await openCopyDialog(actor, "王小明");

    await pickTarget(actor, "何家華");

    expect(await within(dialog).findByText("新增:內容組")).toBeInTheDocument();
    expect(
      within(dialog).getByText("新增:編輯(租戶 A)、審核員(租戶 A)"),
    ).toBeInTheDocument();
  });

  it("切到取代就重新預覽(送出 mode: REPLACE 的試算)", async () => {
    const { user: actor, fake } = renderPage();
    const dialog = await openCopyDialog(actor, "王小明");
    await pickTarget(actor, "何家華");
    await within(dialog).findByText("新增:內容組");

    await actor.click(within(dialog).getByRole("radio", { name: /取代/ }));

    expect(
      await within(dialog).findByText("移除:租戶管理員(租戶 A)"),
    ).toBeInTheDocument();
    expect(
      fake.inputs.copyUserOrgRoles.map((input) => [input.mode, input.dryRun]),
    ).toEqual([
      ["MERGE", true],
      ["REPLACE", true],
    ]);
  });

  it("沒有差異:顯示「組織與角色已符合,不需變更」,確認鈕停用", async () => {
    const { user: actor } = renderPage();
    const dialog = await openCopyDialog(actor, "路人0");

    await pickTarget(actor, "路人1");

    expect(
      await within(dialog).findByText("組織與角色已符合,不需變更"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認複製" }),
    ).toBeDisabled();
  });

  it("有擋下的原因:逐條列出,確認鈕停用", async () => {
    const { user: actor } = renderPage({
      world: {
        copy: {
          blockers: [
            {
              code: CopyUserOrgRolesBlockerCode.RoleDisabled,
              roleId: "role-editor",
              orgId: null,
            },
          ],
        },
      },
    });
    const dialog = await openCopyDialog(actor, "王小明");

    await pickTarget(actor, "何家華");

    expect(
      await within(dialog).findByText("角色「編輯」已停用,不能指派。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認複製" }),
    ).toBeDisabled();
  });

  it("範圍外的角色會照樣保留時多一行提示", async () => {
    const { user: actor } = renderPage({
      world: { copy: { outOfScopeKept: true } },
    });
    const dialog = await openCopyDialog(actor, "王小明");

    await pickTarget(actor, "何家華");

    expect(
      await within(dialog).findByText(
        /取代後可能不再符合授予資格,但會照樣保留/,
      ),
    ).toBeInTheDocument();
  });

  it("確認後跳成功提示、關閉彈窗,清單重查後看得到目標的新角色", async () => {
    const { user: actor, fake } = renderPage();
    const dialog = await openCopyDialog(actor, "王小明");
    await pickTarget(actor, "何家華");
    await within(dialog).findByText("新增:內容組");

    await actor.click(within(dialog).getByRole("button", { name: "確認複製" }));

    expect(await findSnackbarAlert()).toEqual({
      text: "已把組織與角色複製給 何家華。",
      severity: "success",
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      await within(rowOf("何家華")).findByText("審核員"),
    ).toBeInTheDocument();
    expect(fake.inputs.copyUserOrgRoles.at(-1)?.dryRun).toBe(false);
  });

  it("送出失敗:留在彈窗顯示原因", async () => {
    const { user: actor } = renderPage();
    // 只讓正式送出失敗;試算照常交給 userWorld 的 handler(回 undefined = 往下一個 handler)
    server.use(
      api.mutation("CopyUserOrgRoles", ({ variables }) => {
        const { input } = variables as { input: { dryRun?: boolean } };
        return input.dryRun === false
          ? graphqlError("OWNER_PROTECTED")
          : undefined;
      }),
    );
    const dialog = await openCopyDialog(actor, "王小明");
    await pickTarget(actor, "何家華");
    await within(dialog).findByText("新增:內容組");

    await actor.click(within(dialog).getByRole("button", { name: "確認複製" }));

    expect(
      await within(dialog).findByText(
        "頂層組織的擁有者受保護,這個動作被拒絕。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(querySnackbar()).toBeNull();
  });
});
