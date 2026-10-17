import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { currentSearch, urlJson } from "@/test/url-reload";

import { renderPage } from "./user-manager-test-support";

describe("使用者管理:清單條件存在網址(REACT-14)", () => {
  it("組織、搜尋、頁碼寫進 `?list=`;重新整理後條件還在", async () => {
    const first = renderPage();
    expect(await screen.findByText("何家華")).toBeInTheDocument();

    await first.user.click(screen.getByRole("button", { name: "前往第 2 頁" }));
    await waitFor(() => {
      expect(urlJson("list")).toEqual({ org: null, keyword: "", page: 2 });
    });
    first.unmount();

    const second = renderPage({ search: currentSearch() });
    await waitFor(() => {
      expect(second.fake.inputs.users.at(-1)?.page).toBe(2);
    });
    expect(
      await screen.findByRole("button", { current: "page" }),
    ).toHaveTextContent("2");

    await second.user.click(screen.getByText("內容組"));
    await second.user.type(screen.getByLabelText("搜尋"), "王");
    await waitFor(() => {
      expect(urlJson("list")).toEqual({
        org: "org-content",
        keyword: "王",
        page: 1,
      });
    });
    second.unmount();

    const third = renderPage({ search: currentSearch() });
    await waitFor(() => {
      expect(third.fake.inputs.users.at(-1)).toMatchObject({
        orgId: "org-content",
        keyword: "王",
        page: 1,
      });
    });
    expect(screen.getByLabelText("搜尋")).toHaveValue("王");
  });
});
