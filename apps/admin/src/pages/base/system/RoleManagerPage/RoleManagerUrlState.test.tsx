import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { currentSearch, urlJson, urlParam } from "@/test/url-reload";

import { renderRolePage } from "./role-manager-test-support";

describe("角色管理:清單條件、選中的角色與頁籤存在網址(REACT-14)", () => {
  it("擁有組織、搜尋、頁碼(`?list=`)、選中的角色(`?detail=`)、頁籤(`?tab=`)重新整理後都還在", async () => {
    const first = renderRolePage();
    await screen.findByText("內容編輯");

    await first.user.click(screen.getByLabelText("依擁有組織篩選"));
    await first.user.click(
      await screen.findByRole("option", { name: "租戶 A / 內容組" }),
    );
    await first.user.type(screen.getByLabelText("搜尋"), "審核");
    await first.user.click(await screen.findByText("審核員"));
    await first.user.click(screen.getByRole("tab", { name: "分配使用者" }));
    await waitFor(() => {
      expect(urlParam("tab")).toBe("users");
    });
    expect(urlJson("list")).toEqual({
      keyword: "審核",
      ownerOrgId: "org-content",
      page: 1,
    });
    const detail = urlParam("detail");
    expect(detail).not.toBeNull();
    first.unmount();

    const second = renderRolePage({ search: currentSearch() });

    await waitFor(() => {
      expect(second.fake.inputs.roles.at(-1)).toMatchObject({
        ownerOrgId: "org-content",
        keyword: "審核",
        page: 1,
      });
    });
    expect(screen.getByLabelText("搜尋")).toHaveValue("審核");
    expect(
      await screen.findByRole("tab", { name: "分配使用者" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("審核員 — 分配使用者")).toBeInTheDocument();
    expect(urlParam("detail")).toBe(detail);
  });
});
