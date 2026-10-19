import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { RoleKind } from "@repo/graphql";

import { ROLE_MANAGER_PERMISSIONS } from "./role-manager-permissions";
import { ALL_PERMISSIONS, renderRolePage } from "./role-manager-test-support";

describe("角色管理頁(/system/role-manager)", () => {
  it("清單顯示角色與標籤,預設選中第一筆,搜尋送出關鍵字", async () => {
    const { user: actor, fake } = renderRolePage();

    expect(await screen.findByText("內容編輯")).toBeInTheDocument();
    expect(screen.getByText("系統內建")).toBeInTheDocument();
    expect(screen.getByText("預設角色")).toBeInTheDocument();
    expect(screen.getByText("租戶 A · 持有 2 人")).toBeInTheDocument();
    // 預設選中第一筆 → 右邊直接是它的權限設定
    expect(await screen.findByText("內容編輯 — 權限設定")).toBeInTheDocument();

    await actor.type(screen.getByLabelText("搜尋"), "審核");
    await waitFor(() => {
      expect(fake.inputs.roles.at(-1)?.keyword).toBe("審核");
    });
  });

  it("擁有組織下拉與搜尋框並存,兩個條件一起送給 api", async () => {
    const { user: actor, fake } = renderRolePage();

    await screen.findByText("內容編輯");
    // 預設是「全部組織」= 不帶 ownerOrgId
    await waitFor(() => {
      expect(fake.inputs.roles.at(-1)?.ownerOrgId).toBeNull();
    });

    const filter = screen.getByLabelText("依擁有組織篩選");
    await actor.click(filter);
    await actor.click(
      await screen.findByRole("option", { name: "租戶 A / 內容組" }),
    );
    await waitFor(() => {
      expect(fake.inputs.roles.at(-1)?.ownerOrgId).toBe("org-content");
    });

    await actor.type(screen.getByLabelText("搜尋"), "審核");
    await waitFor(() => {
      expect(fake.inputs.roles.at(-1)).toMatchObject({
        ownerOrgId: "org-content",
        keyword: "審核",
        page: 1,
      });
    });
  });

  it("新增角色:擁有組織預設當前組織、欄位下有固定提示,送出帶擁有組織", async () => {
    const { user: actor, fake } = renderRolePage();

    await screen.findByText("內容編輯");
    await actor.click(screen.getByRole("button", { name: "+ 新增" }));

    expect(
      screen.getByText("這個角色的持有者可以管理此組織與它底下的所有組織"),
    ).toBeInTheDocument();

    await actor.type(screen.getByLabelText("名稱"), "南港店管理員");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createRole.at(-1)).toEqual({
        name: "南港店管理員",
        description: null,
        ownerOrgId: "org-tenant",
      });
    });
  });

  /**
   * 列操作的「編輯」「刪除」改成圖示鈕 —— 沒有可見文字,所以名稱由
   * `aria-label` 給、提示用 `describeChild={false}`(REACT-10 的「提示就是名字」那一類)。
   * 「啟用 / 停用」維持文字鈕(Figma Draft/ActionIcon 253:3264 沒有對應圖示)。
   */
  it("列操作:編輯 / 刪除是圖示鈕,hover 出現的提示就是它的名稱", async () => {
    const { user: actor } = renderRolePage();

    // 預設選中第一筆(內容編輯):有編輯與停用,沒有刪除(已有人持有)
    await screen.findByText("內容編輯");

    const edit = screen.getByRole("button", { name: "編輯" });
    // 圖示鈕:按鈕上沒有文字,只有一個 svg
    expect(edit).toHaveTextContent("");
    expect(edit.querySelector("svg")).not.toBeNull();
    // 切換鍵不是圖示鈕,字看得見
    expect(screen.getByRole("button", { name: "停用" })).toHaveTextContent(
      "停用",
    );

    await actor.hover(edit);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("編輯");

    // 審核員(自建、無人持有)才列得出刪除鍵,它一樣是圖示鈕
    await actor.click(screen.getByText("審核員"));
    expect(screen.getByRole("button", { name: "刪除" })).toHaveTextContent("");
  });

  it("右面板頁籤用 @repo/ui/tabs:整列有名稱,鍵盤右鍵移到下一個", async () => {
    const { user: actor } = renderRolePage();

    await screen.findByText("內容編輯 — 權限設定");
    const tablist = screen.getByRole("tablist", { name: "角色分頁" });
    const [matrix, users] = within(tablist).getAllByRole("tab");

    expect(matrix).toHaveAttribute("aria-selected", "true");

    // MUI Tabs 自帶的鍵盤巡覽(自組的 Button 列沒有)
    matrix.focus();
    await actor.keyboard("{ArrowRight}");
    expect(users).toHaveFocus();
  });

  it("編輯角色:擁有組織唯讀,送出只帶名稱與描述", async () => {
    const { user: actor, fake } = renderRolePage();

    await screen.findByText("內容編輯");
    await actor.click(screen.getByRole("button", { name: "編輯" }));

    expect(screen.getByLabelText("擁有組織")).toBeDisabled();

    await actor.clear(screen.getByLabelText("名稱"));
    await actor.type(screen.getByLabelText("名稱"), "內容編輯 2");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateRole.at(-1)).toEqual({
        id: "role-editor",
        name: "內容編輯 2",
        description: "內容管理相關權限",
      });
    });
  });

  it("刪除前置不過:逐項列出原因並提示改用停用", async () => {
    const { user: actor } = renderRolePage({
      world: {
        failures: {
          DeleteRole: {
            code: "ROLE_NOT_DELETABLE",
            reasons: ["HAS_GRANTS", "SYSTEM_ROLE"],
          },
        },
      },
    });

    // 「內容編輯」已有人持有 ⇒ `abilities.canDelete` 為 false、列上沒有刪除鍵;
    // 要驗這個彈窗得挑一個列得出刪除鍵的角色(審核員:自建、無人持有)
    await screen.findByText("內容編輯");
    await actor.click(screen.getByText("審核員"));
    await actor.click(screen.getByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "刪除" }));

    expect(
      await screen.findByText("還有使用者持有這個角色,請先把他們移除。"),
    ).toBeInTheDocument();
    expect(screen.getByText("這是系統內建角色。")).toBeInTheDocument();
    expect(screen.getByText(/不能刪除時可以改用「停用」/)).toBeInTheDocument();
  });

  it("被人員條件引用:原因底下逐項列出引用處", async () => {
    const { user: actor } = renderRolePage({
      world: {
        failures: {
          DeleteRole: {
            code: "ROLE_NOT_DELETABLE",
            reasons: ["HAS_GRANTS", "REFERENCED_BY_AUDIENCE"],
            references: [
              { kind: "notification-setting", name: "列印代理程式離線" },
              {
                kind: "workflow-approver",
                name: "請購單",
                stepName: "財務審核",
              },
              {
                kind: "workflow-step-cc",
                name: "請假單",
                stepName: "主管審核",
              },
              {
                kind: "workflow-overdue",
                name: "採購單",
                stepName: "主管審核",
              },
              { kind: "workflow-cc", name: "出差單" },
              { kind: "data-scope", name: "示範資料" },
              { kind: "unknown-kind", name: "認不得的種類" },
            ],
          },
        },
      },
    });

    await screen.findByText("內容編輯");
    await actor.click(screen.getByText("審核員"));
    await actor.click(screen.getByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "刪除" }));

    expect(
      await screen.findByText(/下列設定的人員條件還用到這個角色/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("還有使用者持有這個角色,請先把他們移除。"),
    ).toBeInTheDocument();
    for (const text of [
      "通知設定「列印代理程式離線」的收件人",
      "流程「請購單」關卡「財務審核」的審核者",
      "流程「請假單」關卡「主管審核」的知會對象",
      "流程「採購單」關卡「主管審核」逾時提醒的通知對象",
      "流程「出差單」整個流程的知會對象",
      "資料範圍「示範資料」的套用對象",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText(/認不得的種類/)).not.toBeInTheDocument();
    expect(screen.getByText(/不能刪除時可以改用「停用」/)).toBeInTheDocument();
  });

  it("停用角色:確認後送出 setRoleEnabled", async () => {
    const { user: actor, fake } = renderRolePage();

    await screen.findByText("內容編輯");
    await actor.click(screen.getByRole("button", { name: "停用" }));
    expect(await screen.findByText("停用 內容編輯?")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "停用" }));

    await waitFor(() => {
      expect(fake.inputs.setRoleEnabled.at(-1)).toEqual({
        id: "role-editor",
        enabled: false,
      });
    });
  });

  it("只有檢視權限時,新增 / 編輯 / 停用 / 刪除 / 儲存 / 加入使用者都不出現", async () => {
    renderRolePage({
      permissions: ALL_PERMISSIONS.filter(
        (key) =>
          key === ROLE_MANAGER_PERMISSIONS.view ||
          !key.startsWith("system.role-manager."),
      ),
    });

    await screen.findByText("內容編輯");
    expect(
      screen.queryByRole("button", { name: "+ 新增" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "停用" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刪除" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "儲存變更" }),
    ).not.toBeInTheDocument();
  });

  it("沒有檢視權限時整頁只剩提示,不送清單查詢", async () => {
    const { fake } = renderRolePage({ permissions: [] });

    expect(
      await screen.findByText("你沒有角色管理的檢視權限,看不到角色清單。"),
    ).toBeInTheDocument();
    expect(fake.inputs.roles).toHaveLength(0);
  });

  /**
   * 列上的動作 = 操作者的權限 × 這個角色的 `abilities`(種類規則由 api 算)。
   * 夾具的 `abilities` 照 api 的規則表推,見 `test/msw/role-fixtures.ts`。
   */
  describe("角色種類規則:動作按鈕讀 abilities", () => {
    it("種子角色:沒有編輯 / 停用 / 刪除,矩陣唯讀並說明內容隨版本更新", async () => {
      const { user: actor } = renderRolePage();

      await screen.findByText("內容編輯");
      await actor.click(screen.getByText("超級管理員"));

      expect(
        screen.queryByRole("button", { name: "編輯" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "停用" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "刪除" }),
      ).not.toBeInTheDocument();
      // 矩陣唯讀:沒有儲存鍵,並標一句為什麼
      expect(
        screen.queryByRole("button", { name: "儲存變更" }),
      ).not.toBeInTheDocument();
      expect(
        await screen.findByText("系統內建角色,內容隨版本更新,這裡只能檢視。"),
      ).toBeInTheDocument();
    });

    it("預設角色:改得動、刪不掉;非 root 停不掉(canToggleEnabled = false)", async () => {
      const { user: actor } = renderRolePage();

      await screen.findByText("內容編輯");
      await actor.click(screen.getByText("租戶管理員"));

      expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "停用" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "刪除" }),
      ).not.toBeInTheDocument();
    });

    it("root 視角:api 把預設角色的 canToggleEnabled 算成 true,列上就出現停用", async () => {
      const { user: actor } = renderRolePage({
        world: {
          roles: [
            {
              id: "role-admin",
              name: "租戶管理員",
              description: "租戶內全部模組",
              enabled: true,
              kind: RoleKind.TemplateCopy,
              abilities: {
                canEdit: true,
                canEditMatrix: true,
                // root 視角:預設角色停得掉
                canToggleEnabled: true,
                canDelete: false,
              },
              isSystem: false,
              isTemplateCopy: true,
              userCount: 1,
              ownerOrg: {
                id: "org-tenant",
                name: "租戶 A",
                tenantTop: { id: "org-tenant", name: "租戶 A" },
              },
            },
          ],
        },
      });

      await screen.findByText("租戶管理員");
      await actor.click(screen.getByText("租戶管理員"));
      expect(screen.getByRole("button", { name: "停用" })).toBeInTheDocument();
    });

    it("自鎖:操作者自己持有的角色,api 回 canToggleEnabled = false,沒有停用鍵", async () => {
      const { user: actor } = renderRolePage({
        world: {
          roles: [
            {
              id: "role-editor",
              name: "內容編輯",
              description: null,
              enabled: true,
              kind: RoleKind.Custom,
              abilities: {
                canEdit: true,
                canEditMatrix: true,
                // 操作者自己正持有它 → 停用會把自己鎖在外面
                canToggleEnabled: false,
                canDelete: false,
              },
              isSystem: false,
              isTemplateCopy: false,
              userCount: 1,
              ownerOrg: {
                id: "org-tenant",
                name: "租戶 A",
                tenantTop: { id: "org-tenant", name: "租戶 A" },
              },
            },
          ],
        },
      });

      await screen.findByText("內容編輯");
      await actor.click(screen.getByText("內容編輯"));
      expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "停用" }),
      ).not.toBeInTheDocument();
    });

    it("根組織視角:清單依租戶頂層分組,標題是租戶名稱", async () => {
      renderRolePage({
        world: {
          roles: [
            {
              id: "role-admin-a",
              name: "租戶管理員",
              description: null,
              enabled: true,
              kind: RoleKind.TemplateCopy,
              abilities: {
                canEdit: true,
                canEditMatrix: true,
                canToggleEnabled: true,
                canDelete: false,
              },
              isSystem: false,
              isTemplateCopy: true,
              userCount: 1,
              ownerOrg: {
                id: "org-tenant",
                name: "租戶 A",
                tenantTop: { id: "org-tenant", name: "租戶 A" },
              },
            },
            {
              id: "role-admin-b",
              name: "租戶管理員",
              description: null,
              enabled: true,
              kind: RoleKind.TemplateCopy,
              abilities: {
                canEdit: true,
                canEditMatrix: true,
                canToggleEnabled: true,
                canDelete: false,
              },
              isSystem: false,
              isTemplateCopy: true,
              userCount: 1,
              ownerOrg: {
                id: "org-tenant-b",
                name: "租戶 B",
                tenantTop: { id: "org-tenant-b", name: "租戶 B" },
              },
            },
          ],
        },
      });

      // 兩筆同名角色靠租戶分組與「擁有組織」那一行分辨
      await screen.findAllByText("租戶管理員");
      expect(await screen.findByText("租戶 A · 持有 1 人")).toBeInTheDocument();
      expect(screen.getByText("租戶 B · 持有 1 人")).toBeInTheDocument();
    });
  });
});
