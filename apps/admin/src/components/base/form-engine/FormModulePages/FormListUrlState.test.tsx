import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { FormSubmissionStatus } from "@repo/graphql";

import { DEMO_FORM_ROUTES, submissionFragment } from "@/test/msw/form-fixtures";
import { currentSearch, urlJson } from "@/test/url-reload";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntimeOptions,
  renderShopping,
} from "./form-module-test-support";

setupFakeViewport();

const world = () => ({
  ...defaultRuntimeOptions(),
  submissions: [submissionFragment()],
});

describe("表單模組列表頁:篩選存在網址(REACT-14)", () => {
  it("搜尋、狀態寫進 `?list=`;重新整理後條件還在、清單照條件查", async () => {
    const first = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: world(),
    });
    await screen.findByRole("table");

    await first.user.type(screen.getByLabelText("搜尋"), "耳機");
    await first.user.click(screen.getByRole("combobox", { name: "狀態" }));
    await first.user.click(await screen.findByRole("option", { name: "草稿" }));
    await waitFor(() => {
      expect(urlJson("list")).toEqual({
        keyword: "耳機",
        formKey: null,
        status: FormSubmissionStatus.Draft,
        orgId: null,
        dateFrom: null,
        dateTo: null,
        page: 1,
      });
    });
    first.unmount();

    const second = renderShopping({
      path: `${DEMO_FORM_ROUTES.list}${currentSearch()}`,
      world: world(),
    });

    await waitFor(() => {
      expect(second.world.inputs.formSubmissions.at(-1)).toMatchObject({
        keyword: "耳機",
        status: FormSubmissionStatus.Draft,
        page: 1,
      });
    });
    expect(screen.getByLabelText("搜尋")).toHaveValue("耳機");
    expect(screen.getByRole("combobox", { name: "狀態" })).toHaveTextContent(
      "草稿",
    );
  });

  it("頁碼在 `?list=`:帶頁碼打開(重新整理)照那一頁查", async () => {
    const list = encodeURIComponent('{"page":3}');
    const { world: runtime } = renderShopping({
      path: `${DEMO_FORM_ROUTES.list}?list=${list}`,
      world: world(),
    });

    await waitFor(() => {
      expect(runtime.inputs.formSubmissions.at(-1)?.page).toBe(3);
    });
  });
});
