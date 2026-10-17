import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { currentSearch, urlJson } from "@/test/url-reload";

import {
  SAMPLE_TWO_ROUTES,
  renderSampleTwo,
} from "../demo-sample-two-test-support";

describe("示範模組2 列表:搜尋存在網址(REACT-14)", () => {
  it("搜尋寫進 `?list=`;重新整理後還在", async () => {
    const first = renderSampleTwo();
    await screen.findByRole("table");

    await first.user.type(screen.getByLabelText("搜尋"), "對照組");
    await waitFor(() => {
      expect(urlJson("list")).toEqual({
        keyword: "對照組",
        option: null,
        page: 1,
      });
    });
    first.unmount();

    renderSampleTwo({ path: `${SAMPLE_TWO_ROUTES.list}${currentSearch()}` });

    await screen.findByRole("table");
    expect(screen.getByLabelText("搜尋")).toHaveValue("對照組");
  });
});
