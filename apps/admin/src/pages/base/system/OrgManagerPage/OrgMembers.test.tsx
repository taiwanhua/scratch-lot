import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { autocompleteOption } from "@/test/autocomplete";

import { ORG_MANAGER_PERMISSIONS } from "./org-manager-permissions";
import {
  OWN_PERMISSIONS,
  clickNode,
  detail,
  renderPage,
  waitForTree,
} from "./org-manager-test-support";

/** 選「A-1 內容組」→ 切到「成員」頁籤;兩段接力載入,helper 各等一段(TEST-08)。 */
const openMembersTab = async (
  options: Parameters<typeof renderPage>[0] = {},
) => {
  const rendered = renderPage(options);
  await waitForTree();
  await clickNode(rendered.user, "A-1 內容組");
  await within(detail()).findByText("A-1 內容組");
  await rendered.user.click(screen.getByRole("tab", { name: "成員" }));
  await screen.findByText("A-1 內容組 — 成員");
  return rendered;
};

/**
 * 組織詳情的「成員」頁籤:清單、加入成員、權限決定出不出現。
 * 規則正本 `docs/modules/org-manager.md`「成員」與權限表。
 */
describe("組織管理:成員頁籤", () => {
  it("清單只列這個組織自己的成員,含狀態與其他所屬組織", async () => {
    await openMembersTab();

    const table = screen.getByRole("table", { name: "組織成員清單" });
    const owner = within(table).getByRole("row", { name: /何家華/ });
    expect(within(owner).getByText("user-owner")).toBeInTheDocument();
    expect(within(owner).getByText("啟用中")).toBeInTheDocument();
    expect(within(owner).getByText("租戶 A")).toBeInTheDocument();

    // 停用的成員照列,只在狀態欄標示(停用是使用者自己的狀態,與組織無關)
    const leaver = within(table).getByRole("row", { name: /離職者/ });
    expect(within(leaver).getByText("已停用")).toBeInTheDocument();
    expect(within(leaver).getByText("—")).toBeInTheDocument();

    // 下層組織(A-1-1 編輯組)的成員不算這個組織的成員
    expect(within(table).queryByText("陳大文")).toBeNull();
  });

  it("加入成員:候選排除既有成員,送出後清單就多那一位", async () => {
    const { user: actor, fake } = await openMembersTab();

    await actor.click(screen.getByRole("button", { name: "加入成員" }));
    const dialog = screen.getByRole("dialog");
    await actor.click(within(dialog).getByRole("combobox", { name: "使用者" }));

    // 已經是成員的「何家華」不在候選裡(api 的 `orgMemberCandidates` 已排除)
    expect(
      screen.queryAllByRole("option").map((option) => option.textContent),
    ).not.toContainEqual(expect.stringContaining("何家華"));

    await actor.click(autocompleteOption("王小明"));
    expect(within(dialog).getByText("已選 1 人")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "加入" }));

    await waitFor(() => {
      expect(fake.inputs.addOrgMembers.at(-1)).toEqual({
        orgId: "org-content",
        userIds: ["user-new"],
      });
    });
    // 彈窗關閉、清單重查後多一列
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(await screen.findByText("王小明")).toBeInTheDocument();
  });

  it("加入失敗時在彈窗內顯示錯誤,彈窗不關", async () => {
    const { user: actor } = await openMembersTab({
      world: { failures: { AddOrgMembers: { code: "NOT_FOUND" } } },
    });

    await actor.click(screen.getByRole("button", { name: "加入成員" }));
    const dialog = screen.getByRole("dialog");
    await actor.click(within(dialog).getByRole("combobox", { name: "使用者" }));
    await actor.click(autocompleteOption("王小明"));
    await actor.click(within(dialog).getByRole("button", { name: "加入" }));

    expect(
      await within(dialog).findByText(
        "找不到這個組織,或它不在你的可見範圍內。",
      ),
    ).toBeInTheDocument();
  });

  it("只有 view-members:看得到頁籤與清單,沒有「加入成員」按鈕", async () => {
    await openMembersTab({
      permissions: [
        ORG_MANAGER_PERMISSIONS.view,
        ORG_MANAGER_PERMISSIONS.viewMembers,
      ],
    });

    expect(
      screen.getByRole("table", { name: "組織成員清單" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入成員" })).toBeNull();
  });

  it("沒有 view-members:整列頁籤都不出現,資料區維持原本的樣子", async () => {
    const rendered = renderPage({
      permissions: OWN_PERMISSIONS.filter(
        (key) => key !== ORG_MANAGER_PERMISSIONS.viewMembers,
      ),
    });
    await waitForTree();
    await clickNode(rendered.user, "A-1 內容組");
    await within(detail()).findByText("A-1 內容組");

    expect(screen.queryByRole("tab", { name: "成員" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "組織資料" })).toBeNull();
    // 組織資料照常顯示(沒有頁籤不代表少了什麼)
    expect(
      within(detail()).getByText("負責食譜內容產出與審核"),
    ).toBeInTheDocument();
  });
});
