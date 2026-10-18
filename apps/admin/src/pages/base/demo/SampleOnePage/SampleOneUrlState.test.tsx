import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { routeTabsStorageKey } from "@/lib/base/route-tabs";
import { testUser } from "@/test/msw/auth-handlers";
import { currentSearch, urlJson } from "@/test/url-reload";

import {
  SAMPLE_ONE_ROUTES,
  findRowOf,
  renderSampleOne,
} from "../demo-sample-one-test-support";

describe("示範模組1 列表:篩選存在網址(REACT-14)", () => {
  it("搜尋與分類寫進 `?list=`;重新整理後條件還在、清單照條件查", async () => {
    const first = renderSampleOne();
    await findRowOf("醬燒雞腿排");

    await first.user.click(screen.getByLabelText("分類"));
    await first.user.click(await screen.findByRole("option", { name: /小菜/ }));
    await first.user.type(screen.getByLabelText("搜尋"), "黃瓜");
    await waitFor(() => {
      expect(urlJson("list")).toMatchObject({
        keyword: "黃瓜",
        option: { label: expect.stringMatching(/小菜/) },
        page: 1,
      });
    });
    first.unmount();

    renderSampleOne({ path: `${SAMPLE_ONE_ROUTES.list}${currentSearch()}` });

    expect(await screen.findByText("涼拌小黃瓜")).toBeInTheDocument();
    expect(screen.queryByText("醬燒雞腿排")).not.toBeInTheDocument();
    expect(screen.getByLabelText("搜尋")).toHaveValue("黃瓜");
    expect(screen.getByLabelText("分類")).toHaveValue("小菜");
  });

  it("頁碼在 `?list=`:帶頁碼打開(重新整理)照那一頁查", async () => {
    const list = encodeURIComponent('{"page":2}');
    const { fake } = renderSampleOne({
      path: `${SAMPLE_ONE_ROUTES.list}?list=${list}`,
    });

    await waitFor(() => {
      expect(fake.inputs.demoItemsOne.at(-1)?.page).toBe(2);
    });
  });

  it("詳情頁「返回列表」帶回列表頁籤記下的條件", async () => {
    const listSearch = `?list=${encodeURIComponent('{"keyword":"紅茶"}')}`;
    sessionStorage.clear();
    sessionStorage.setItem(
      routeTabsStorageKey(testUser.id),
      JSON.stringify([
        { route: SAMPLE_ONE_ROUTES.list, search: listSearch },
        { route: `${SAMPLE_ONE_ROUTES.viewPage}/demo-1` },
      ]),
    );
    const { user } = renderSampleOne({
      path: `${SAMPLE_ONE_ROUTES.viewPage}/demo-1`,
    });

    await user.click(await screen.findByRole("button", { name: /返回列表/ }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${SAMPLE_ONE_ROUTES.list}${listSearch}`,
      );
    });
    expect(await screen.findByText("古早味紅茶")).toBeInTheDocument();
    expect(screen.getByLabelText("搜尋")).toHaveValue("紅茶");
  });
});
