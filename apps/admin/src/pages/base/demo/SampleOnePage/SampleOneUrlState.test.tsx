import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

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
});
