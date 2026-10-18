import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { heightChainOf } from "@/test/height-chain";
import { tenantTree } from "@/test/msw/org-fixtures";

import { ORG_MANAGER_PERMISSIONS } from "./org-manager-permissions";
import {
  OWN_PERMISSIONS,
  USER_VIEW_PERMISSION,
  clickNode,
  detail,
  renderPage,
  stubObjectUrl,
  treeItem,
  treeLabel,
  waitForTree,
} from "./org-manager-test-support";

stubObjectUrl();

describe("組織管理頁(/system/org-manager)", () => {
  it("根組織視角:樹以根組織為根、租戶與停用各自帶標籤,預設選中樹根", async () => {
    renderPage();

    await waitForTree();
    // 「租戶」標籤要等 `org(樹根)` 回來才確定(樹根是不是平台根組織看 `isSystem`)
    await waitFor(() => {
      expect(treeLabel("租戶 A")).toBe("租戶 A租戶");
    });
    expect(treeLabel("A-2 台北分店")).toBe("A-2 台北分店停用");
    // 「租戶」標籤標的是**父節點是平台根組織**的節點,所以兩個租戶都有、下層組織沒有
    expect(treeLabel("租戶 B")).toBe("租戶 B租戶");
    // 管理範圍外的組織根本不回傳,樹上不再有「顯示但不可選」的灰節點
    expect(treeItem("租戶 B")?.getAttribute("aria-disabled")).toBeNull();
    // 預設選中的樹根是根組織 → 它是系統組織,停用與刪除都停用
    expect(await within(detail()).findByText("啟用中")).toBeInTheDocument();
    expect(
      within(detail()).getByRole("button", { name: "停用" }),
    ).toBeDisabled();
    expect(
      within(detail()).getByRole("button", { name: "刪除" }),
    ).toBeDisabled();
  });

  it("租戶視角:樹根是租戶頂層、沒有租戶標籤,也沒有開通租戶按鈕", async () => {
    renderPage({
      permissions: OWN_PERMISSIONS,
      world: { orgTree: tenantTree },
    });

    await waitForTree();
    expect(treeLabel("租戶 A")).toBe("租戶 A");
    expect(
      screen.queryByRole("button", { name: "開通租戶" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "+ 子組織" }),
    ).toBeInTheDocument();
  });

  it("只有檢視權限時,動作按鈕一個都不出現", async () => {
    renderPage({ permissions: [ORG_MANAGER_PERMISSIONS.view] });

    await waitForTree();
    for (const label of ["編輯", "停用", "刪除", "+ 子組織", "開通租戶"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("選中租戶頂層時顯示商標與擁有者;一般組織沒有這兩列", async () => {
    const { user: actor } = renderPage();

    await waitForTree();

    // 先看一般組織:沒有商標、也沒有擁有者
    await clickNode(actor, "A-1 內容組");
    await waitFor(() => {
      expect(
        within(detail()).getByText("負責食譜內容產出與審核"),
      ).toBeInTheDocument();
    });
    expect(within(detail()).queryByText("擁有者")).not.toBeInTheDocument();

    // 再看租戶頂層:兩者都有
    await clickNode(actor, "租戶 A");
    expect(await within(detail()).findByText("何家華")).toBeInTheDocument();
    expect(screen.getByAltText("租戶 A 的商標")).toBeInTheDocument();
  });

  it("編輯彈窗:租戶頂層 + 持對應權限才有擁有者與可見範圍兩欄", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "租戶 A");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    expect(await screen.findByLabelText("擁有者")).toBeInTheDocument();
    const visibility = screen.getByRole("switch");
    expect(visibility).not.toBeChecked();

    await actor.click(visibility);
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.setOrgVisibility).toHaveLength(1);
    });
    expect(fake.inputs.setOrgVisibility[0]?.visibility).toBe("SUBTREE");
    // 名稱 / 描述沒動過就不送 updateOrg(api 不留空的審計紀錄)
    expect(fake.inputs.updateOrg).toHaveLength(0);
  });

  it("編輯彈窗:非租戶頂層沒有擁有者與可見範圍兩欄", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    await clickNode(actor, "A-1 內容組");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    expect(await screen.findByLabelText("名稱 *")).toBeInTheDocument();
    expect(screen.queryByLabelText("擁有者")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("編輯彈窗:兩邊的權限都沒有時,租戶頂層也看不到那兩欄", async () => {
    const { user: actor } = renderPage({
      permissions: [...OWN_PERMISSIONS, USER_VIEW_PERMISSION],
    });

    await waitForTree();
    await clickNode(actor, "租戶 A");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    expect(await screen.findByLabelText("名稱 *")).toBeInTheDocument();
    expect(screen.queryByLabelText("擁有者")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("搬移:「上層組織」只給同租戶、非自己子樹的選項,送出打 moveOrg", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "A-2 台北分店");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    await actor.click(await screen.findByLabelText("上層組織(搬移)"));
    const options = screen
      .getAllByRole("option")
      .map((item) => item.textContent);
    expect(options).toContain("租戶 A / A-1 內容組");
    // 自己不能當自己的上層,根組織與別的租戶也不在同一個租戶裡
    expect(options).not.toContain("租戶 A / A-2 台北分店");
    expect(options).not.toContain("平台根組織");

    await actor.click(
      screen.getByRole("option", { name: "租戶 A / A-1 內容組" }),
    );
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.moveOrg).toHaveLength(1);
    });
    expect(fake.inputs.moveOrg[0]).toEqual({
      id: "org-store",
      newParentId: "org-content",
    });
  });

  it("商標上傳:取簽名網址 → 直傳 → 把 objectPath 當 logoPath 送出", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "A-1 內容組");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    const picker = await screen.findByLabelText("商標(選填)");
    await actor.upload(
      picker,
      new File(["logo-bytes"], "logo.png", { type: "image/png" }),
    );
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateOrg).toHaveLength(1);
    });
    expect(fake.inputs.createUploadUrl[0]?.contentType).toBe("image/png");
    expect(fake.uploadedFiles).toHaveLength(1);
    expect(fake.uploadedFiles[0]?.contentType).toBe("image/png");
    expect(fake.inputs.updateOrg[0]?.logoPath).toBe("org-logos/1.png");
  });

  it("刪除被拒:逐項列出原因並提示改用停用", async () => {
    const { user: actor } = renderPage({
      world: {
        failures: {
          DeleteOrg: {
            code: "ORG_NOT_DELETABLE",
            extensions: { reasons: ["HAS_CHILDREN", "HAS_MEMBERS"] },
          },
        },
      },
    });

    await waitForTree();
    await clickNode(actor, "A-1 內容組");
    await actor.click(
      await within(detail()).findByRole("button", { name: "刪除" }),
    );
    await actor.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "刪除" }),
    );

    expect(await screen.findByText("還有下層組織")).toBeInTheDocument();
    expect(screen.getByText("還有成員屬於這個組織")).toBeInTheDocument();
    expect(
      screen.getByText(
        "請改用「停用」— 停用會連同全部下層組織一起停用,資料照樣保留。",
      ),
    ).toBeInTheDocument();
  });

  it("停用確認:文案說明連動整棵子樹,確認後送出", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "A-1 內容組");
    await actor.click(
      await within(detail()).findByRole("button", { name: "停用" }),
    );

    expect(
      await screen.findByText(/與其全部下層組織將一併停用/),
    ).toBeInTheDocument();
    await actor.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "停用" }),
    );

    await waitFor(() => {
      expect(fake.inputs.setOrgEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setOrgEnabled[0]).toEqual({
      id: "org-content",
      enabled: false,
    });
  });

  it("新增子組織:掛在目前選中的組織底下", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "A-1 內容組");
    await actor.click(await screen.findByRole("button", { name: "+ 子組織" }));

    await actor.type(await screen.findByLabelText("名稱 *"), "食譜小組");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createChildOrg).toHaveLength(1);
    });
    expect(fake.inputs.createChildOrg[0]).toEqual({
      parentId: "org-content",
      name: "食譜小組",
      description: null,
    });
  });

  it("開通彈窗:預設全勾,取消群組連動下層、勾下層連動上層", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await actor.click(await screen.findByRole("button", { name: "開通租戶" }));

    const systemBox = await screen.findByRole("checkbox", { name: "系統管理" });
    const orgBox = screen.getByRole("checkbox", { name: "組織管理" });
    const userBox = screen.getByRole("checkbox", { name: "使用者管理" });
    expect(systemBox).toBeChecked();
    expect(orgBox).toBeChecked();

    await actor.click(systemBox);
    expect(orgBox).not.toBeChecked();
    expect(userBox).not.toBeChecked();

    await actor.click(orgBox);
    expect(systemBox).toBeChecked();
    expect(userBox).not.toBeChecked();

    await actor.type(screen.getByLabelText("租戶名稱 *"), "租戶 C");
    await actor.type(screen.getByLabelText("租戶短碼 *"), "tenant_c");
    await actor.type(
      screen.getByLabelText("首任租戶管理員 Email *"),
      "admin@tenant-c.tw",
    );
    await actor.click(screen.getByRole("button", { name: "開通" }));

    await waitFor(() => {
      expect(fake.inputs.provisionTenant).toHaveLength(1);
    });
    const input = fake.inputs.provisionTenant[0];
    expect(input.moduleKeys).toEqual([
      "overview",
      "system",
      "system.org-manager",
    ]);
    expect(input.slug).toBe("tenant_c");
    // 帳號沒動過 → 預設帶入 Email
    expect(input.adminAccount).toBe("admin@tenant-c.tw");
    expect(input.adminEmail).toBe("admin@tenant-c.tw");
  });

  /** Figma 202:351 的每層 28px 縮排(= theme.spacing(3.5))。 */
  it("開通彈窗:模組清單依層級縮排,每層 28px", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    await actor.click(await screen.findByRole("button", { name: "開通租戶" }));
    await screen.findByRole("checkbox", { name: "系統管理" });

    // 縮排掛在列上:`data-depth` 是層級、`padding-left` 是實際縮排
    const rows = [...document.querySelectorAll<HTMLElement>("[data-depth]")];

    expect(
      rows.map(
        (row) =>
          `${row.textContent} ${row.dataset.depth ?? ""} ${globalThis.getComputedStyle(row).paddingLeft}`,
      ),
    ).toEqual([
      // jsdom 不算 CSS 變數,所以下層那兩列的值是 spacing(3.5) 的算式 = 28px
      "總覽 0 0px",
      "系統管理 0 0px",
      "組織管理 1 calc(3.5 * var(--mui-spacing))",
      "使用者管理 1 calc(3.5 * var(--mui-spacing))",
    ]);
  });

  /**
   * 左樹 / 右區塊撐滿殼給的內容區高度、各自內部捲動(Figma 87:3)。
   * jsdom 不算版面,所以驗的是**高度鏈的宣告**(`heightChainOf` 的註解說明為什麼這樣就夠)。
   */
  it("左樹與右區塊各自一層捲動,中間每一層都 min-height: 0", async () => {
    renderPage();
    await waitForTree();

    const treeChain = heightChainOf(
      screen.getByRole("tree", { name: "組織樹" }),
    );
    const detailChain = heightChainOf(detail());

    for (const chain of [treeChain, detailChain]) {
      // 鏈的最外層一定是 <main>(高度是殼給的,STYLE-08)
      expect(chain.at(-1)?.label).toBe("MAIN.MuiBox-root");
      // 每一層都要 min-height: 0,少一層就被內容撐高、flex: 1 等於沒作用
      expect(chain.map((link) => link.minHeight)).toEqual(chain.map(() => "0"));
      // 捲動只有最內層那一層(最外層的 <main> 是其他頁在捲的那一層,不算在內)
      expect(chain.slice(1, -1).filter((link) => link.scrolls)).toEqual([]);
    }

    // 兩塊各自捲:左邊捲的是樹外面那個 Box、右邊是資料卡自己
    expect(treeChain[0]?.label).toBe("DIV.MuiBox-root");
    expect(detailChain[0]?.label).toBe("SECTION.MuiPaper-root");
  });
});
