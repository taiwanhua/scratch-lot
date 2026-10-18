import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { heightChainOf } from "@/test/height-chain";

import {
  ORG_MANAGER_VIEW_PERMISSION,
  USER_MANAGER_PERMISSIONS,
} from "./user-manager-permissions";
import {
  ALL_PERMISSIONS,
  orgCheckboxOf,
  renderPage,
  rowOf,
} from "./user-manager-test-support";

describe("使用者管理頁(/system/user-manager)", () => {
  it("左樹選組織後清單收斂到該組織子樹,分頁換頁重查", async () => {
    const { user: actor, fake } = renderPage();

    expect(await screen.findByText("何家華")).toBeInTheDocument();
    expect(screen.getByText("共 12 筆,每頁 10 筆")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "前往第 2 頁" }));
    await waitFor(() => {
      expect(fake.inputs.users.at(-1)?.page).toBe(2);
    });

    await actor.click(screen.getByText("內容組"));
    await waitFor(() => {
      expect(fake.inputs.users.at(-1)?.orgId).toBe("org-content");
    });
    expect(await screen.findByText("王小明")).toBeInTheDocument();
    expect(screen.queryByText("何家華")).not.toBeInTheDocument();
  });

  /**
   * 以前一開始沒選組織就送 `orgId: null`,api 回
   * `orgId is not a valid id: null`。現在預設選中樹根,樹還沒到手就先不查。
   */
  it("初始狀態:預設選中樹根,送出的 orgId 一律不是 null", async () => {
    const { fake } = renderPage();

    await screen.findByText("何家華");
    // 第一次查詢就帶樹根,而且從頭到尾沒有一次 orgId 是 null
    expect(fake.inputs.users[0]?.orgId).toBe("org-tenant");
    expect(fake.inputs.users.every((input) => input.orgId !== null)).toBe(true);
  });

  it("沒有組織樹權限時不給 orgId(攤開整個可見範圍),清單照樣查得到", async () => {
    const { fake } = renderPage({
      permissions: ALL_PERMISSIONS.filter(
        (key) => key !== ORG_MANAGER_VIEW_PERMISSION,
      ),
    });

    await screen.findByText("何家華");
    expect(fake.inputs.users[0]?.orgId).toBeUndefined();
  });

  it("角色欄以「組織外」標示失去組織支撐的授予,所屬組織多筆時收成 +N", async () => {
    renderPage();

    const row = await screen.findByRole("row", { name: /王小明/ });
    expect(within(row).getByText("組織外")).toBeInTheDocument();
    expect(within(row).getByText("+1")).toBeInTheDocument();
  });

  it("擁有者的停用動作 disabled 並提示,其他人正常", async () => {
    const { user: actor } = renderPage();

    await screen.findByText("何家華");
    // 擁有者由 `org(樹根)` 的 ownerUserId 決定,那是第二個查詢,可能比清單晚回來
    await waitFor(() => {
      expect(
        within(rowOf("何家華")).getByRole("button", { name: "停用" }),
      ).toBeDisabled();
    });
    // 提示改用 @repo/ui 的 Tooltip(REACT-10):停用的按鈕收不到 hover,
    // 事件載體是 Tooltip 自己包的外層 span
    const hintCarrier = within(rowOf("何家華")).getByRole("button", {
      name: "停用",
    }).parentElement;
    if (hintCarrier === null) {
      throw new Error("停用按鈕沒有被 Tooltip 包起來");
    }
    await actor.hover(hintCarrier);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "頂層組織的擁有者受保護,無法執行此動作",
    );
    expect(
      within(rowOf("王小明")).getByRole("button", { name: "停用" }),
    ).toBeEnabled();
  });

  /**
   * api 的 `assertOwnedOrgsKept` 只擋「把擁有者移出他擁有的租戶頂層」,
   * 加入其他組織一直是允許的 —— 畫面以前把整個「所屬組織」按鈕停用,比 api 嚴,
   * 擁有者因此連把自己加進分店都做不到。鎖只在彈窗裡的那一個節點上。
   */
  it("擁有者的所屬組織照常可開:租戶頂層鎖住不可取消,加入其他組織送得出去", async () => {
    const { user: actor, fake } = renderPage();

    await screen.findByText("何家華");
    // 擁有者由 `org(樹根)` 的 ownerUserId 決定,那是第二個查詢,可能比清單晚回來
    await waitFor(() => {
      expect(
        within(rowOf("何家華")).getByRole("button", { name: "停用" }),
      ).toBeDisabled();
    });
    const orgsButton = within(rowOf("何家華")).getByRole("button", {
      name: "所屬組織",
    });
    expect(orgsButton).toBeEnabled();
    await actor.click(orgsButton);

    const tenantCheckbox = await orgCheckboxOf("租戶 A");
    expect(tenantCheckbox).toBeChecked();
    expect(tenantCheckbox).toBeDisabled();
    // 鎖住節點的說明是彈窗專屬的那一句,不是列上「無法執行此動作」那句
    expect(
      screen.getByText(
        "頂層組織的擁有者不能被移出頂層組織;其他組織可自由勾選或取消。",
      ),
    ).toBeInTheDocument();

    // 勾不掉:停用的勾選框連 pointer-events 都沒有,所以用 fireEvent 硬點也切不動
    fireEvent.click(tenantCheckbox);
    expect(tenantCheckbox).toBeChecked();

    await actor.click(await orgCheckboxOf("內容組"));
    await actor.click(screen.getByRole("button", { name: "確定" }));

    // 純粹是「加入」,沒有移除 → 不走 dry-run,直接送出
    await waitFor(() => {
      expect(fake.inputs.setUserOrgs).toHaveLength(1);
    });
    expect(fake.inputs.setUserOrgs[0]).toMatchObject({
      userId: "user-owner",
      dryRun: false,
    });
    expect(fake.inputs.setUserOrgs[0]?.orgIds).toHaveLength(2);
    expect(fake.inputs.setUserOrgs[0]?.orgIds).toEqual(
      expect.arrayContaining(["org-tenant", "org-content"]),
    );
  });

  /**
   * 改的是**登入者自己**的所屬組織時,`me` 也要失效 —— AppBar 的「當前組織」
   * 可切換清單讀的就是 `me.orgs`,而它的 `staleTime` 是 Infinity,不主動失效就不會更新。
   */
  it("改自己的所屬組織後,AppBar 的「當前組織」清單跟著更新", async () => {
    const meOrgs = [{ id: "org-tenant", name: "租戶 A" }];
    const { user: actor, fake } = renderPage({ meOrgs });

    await screen.findByText("何家華");
    // 操作者是清單上的「小華」(`me.id` 同為 user-1)
    await actor.click(
      within(rowOf("小華")).getByRole("button", { name: "所屬組織" }),
    );
    await actor.click(await orgCheckboxOf("內容組"));

    // api 那邊也把自己加進去了(兩個 world 各自獨立,`me` 這份要自己補)
    meOrgs.push({ id: "org-content", name: "內容組" });
    await actor.click(screen.getByRole("button", { name: "確定" }));

    await waitFor(() => {
      expect(fake.inputs.setUserOrgs).toHaveLength(1);
    });
    expect(fake.inputs.setUserOrgs[0]?.userId).toBe("user-1");

    await actor.click(screen.getByRole("combobox", { name: "當前組織" }));
    expect(
      await screen.findByRole("option", { name: "內容組" }),
    ).toBeInTheDocument();
  });

  it("非擁有者的所屬組織彈窗沒有鎖住的節點", async () => {
    const { user: actor } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "所屬組織" }),
    );

    expect(await orgCheckboxOf("租戶 A")).toBeEnabled();
    expect(
      screen.queryByText(
        "頂層組織的擁有者不能被移出頂層組織;其他組織可自由勾選或取消。",
      ),
    ).not.toBeInTheDocument();
  });

  it("新增使用者:選「直接設定初始密碼」才出現密碼欄,送出帶啟用方式與所屬組織", async () => {
    const { user: actor, fake } = renderPage();

    await screen.findByText("何家華");
    await actor.click(screen.getByText("內容組"));
    await actor.click(screen.getByRole("button", { name: "新增使用者" }));

    expect(await screen.findByLabelText("登入帳號 *")).toBeInTheDocument();
    expect(screen.queryByLabelText("初始密碼 *")).not.toBeInTheDocument();

    await actor.click(screen.getByRole("radio", { name: /直接設定初始密碼/ }));
    const password = await screen.findByLabelText("初始密碼 *");

    await actor.type(screen.getByLabelText("登入帳號 *"), "newbie");
    await actor.type(screen.getByLabelText("姓名 *"), "新人");
    await actor.type(
      screen.getByLabelText("Email *"),
      "newbie@cookhome.online",
    );
    await actor.type(password, "secret-1234");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createUser).toHaveLength(1);
    });
    const input = fake.inputs.createUser[0];
    expect(input.activation.mode).toBe("PASSWORD");
    expect(input.activation.initialPassword).toBe("secret-1234");
    expect(input.orgIds).toEqual(["org-content"]);
  });

  it("身分證欄依欄位級權限出現:有 show-national-id 才在編輯彈窗看得到", async () => {
    const { user: actor } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "編輯" }),
    );

    expect(await screen.findByLabelText("身分證(選填)")).toHaveValue(
      "A123456789",
    );
  });

  /**
   * 性別欄原本是裸 `Select`,只掛 `aria-label` —— 畫面上那一格沒有欄位名,
   * 和同列的「暱稱」對不起來(Figma 202:734 是有浮動標籤的下拉)。
   */
  it("性別欄比照其他欄位有看得見的標籤,選項選得動", async () => {
    const { user: actor } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "編輯" }),
    );

    const dialog = await screen.findByRole("dialog");
    /*
     * 「性別」要在畫面上看得到 —— 改之前只有 `aria-label`,這裡一個都找不到。
     * 外框式欄位的標籤文字會出現兩份(浮動標籤 + 外框缺口的 legend),所以用 getAllByText。
     */
    expect(within(dialog).getAllByText("性別").length).toBeGreaterThan(0);

    await actor.click(within(dialog).getByLabelText("性別"));
    await actor.click(await screen.findByRole("option", { name: "女" }));

    expect(within(dialog).getByLabelText("性別")).toHaveTextContent("女");
  });

  it("沒有 show-national-id 時編輯彈窗不渲染身分證欄", async () => {
    const { user: actor } = renderPage({
      permissions: ALL_PERMISSIONS.filter(
        (key) => key !== USER_MANAGER_PERMISSIONS.showNationalId,
      ),
    });

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "編輯" }),
    );

    expect(await screen.findByLabelText("登入帳號 *")).toBeInTheDocument();
    expect(screen.queryByLabelText("身分證(選填)")).not.toBeInTheDocument();
  });

  it("移除所屬組織:先 dry-run 顯示失去資格清單,三檔預設 (c),確認後才正式送出", async () => {
    const { user: actor, fake } = renderPage({
      world: {
        dryRun: {
          removedOrgs: [{ id: "org-content", name: "內容組" }],
          unqualifiedRoles: [
            {
              roleId: "role-editor",
              roleName: "編輯",
              ownerOrgId: "org-content",
              ownerOrgName: "內容組",
              reasons: ["OWNED_BY_REMOVED_ORG"],
              ownerProtected: false,
            },
            {
              roleId: "role-audit",
              roleName: "審核員",
              ownerOrgId: "org-tenant",
              ownerOrgName: "租戶 A",
              reasons: ["NO_REMAINING_SUBTREE_SUPPORT"],
              ownerProtected: false,
            },
          ],
        },
      },
    });

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "所屬組織" }),
    );

    await actor.click(await orgCheckboxOf("內容組"));
    await actor.click(screen.getByRole("button", { name: "確定" }));

    expect(await screen.findByText("確認所屬組織變更?")).toBeInTheDocument();
    expect(fake.inputs.setUserOrgs[0]?.dryRun).toBe(true);
    expect(screen.getByText("移除:內容組")).toBeInTheDocument();
    expect(screen.getByText("由被移除的組織擁有")).toBeInTheDocument();
    expect(
      screen.getByText("剩餘的所屬組織都不在該角色的擁有組織底下"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /解除所有因此失去資格的角色/ }),
    ).toBeChecked();

    await actor.click(screen.getByRole("button", { name: "確認變更" }));
    await waitFor(() => {
      expect(fake.inputs.setUserOrgs).toHaveLength(2);
    });
    expect(fake.inputs.setUserOrgs[1]).toMatchObject({
      userId: "user-ming",
      dryRun: false,
      removalPolicy: "REVOKE_ALL_UNQUALIFIED",
      orgIds: ["org-tenant"],
    });
  });

  it("停用彈窗確認後送出,api 回 OWNER_PROTECTED 時顯示原因", async () => {
    const { user: actor, fake } = renderPage({
      world: { failures: { SetUserEnabled: "OWNER_PROTECTED" } },
    });

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "停用" }),
    );
    await actor.click(
      screen.getByRole("button", { name: "停用", hidden: false }),
    );

    await waitFor(() => {
      expect(fake.inputs.setUserEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setUserEnabled[0]).toEqual({
      id: "user-ming",
      enabled: false,
    });
    expect(
      await screen.findByText("頂層組織的擁有者受保護,這個動作被拒絕。"),
    ).toBeInTheDocument();
  });

  it("沒有 create 權限時不顯示新增按鈕", async () => {
    renderPage({
      permissions: ALL_PERMISSIONS.filter(
        (key) => key !== USER_MANAGER_PERMISSIONS.create,
      ),
    });

    await screen.findByText("何家華");
    expect(
      screen.queryByRole("button", { name: "新增使用者" }),
    ).not.toBeInTheDocument();
  });

  /**
   * 左樹 / 右清單撐滿殼給的內容區高度、各自內部捲動(Figma 30:105)。
   * jsdom 不算版面,驗的是**高度鏈的宣告**(理由見 `test/height-chain.ts`);
   * 右邊那條同時是「捲動只留一層」—— 表格容器外面不能再包一層 `overflow: auto`。
   */
  it("左樹與右清單各自一層捲動,中間每一層都 min-height: 0", async () => {
    renderPage();
    await screen.findByText("何家華");

    const treeChain = heightChainOf(screen.getByRole("tree", { name: "組織" }));
    const tableChain = heightChainOf(
      screen.getByRole("table", { name: "使用者清單" }),
    );

    for (const chain of [treeChain, tableChain]) {
      expect(chain.at(-1)?.label).toBe("MAIN.MuiBox-root");
      expect(chain.map((link) => link.minHeight)).toEqual(chain.map(() => "0"));
      expect(chain.slice(1, -1).filter((link) => link.scrolls)).toEqual([]);
    }

    // 清單捲的是 Table 自己的容器,不是外面那層 Box 或 Card
    expect(tableChain[0]?.label).toBe("DIV.MuiTableContainer-root");
  });
});
