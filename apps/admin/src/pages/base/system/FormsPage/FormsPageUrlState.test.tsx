import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { formFragment } from "@/test/msw/form-fixtures";
import { currentSearch, urlJson, urlParam } from "@/test/url-reload";

import {
  FORMS_ALL,
  defaultDesignOptions,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const options = () => ({
  ...defaultDesignOptions(),
  forms: [
    formFragment(),
    formFragment({ id: "form-trip", key: "trip", name: "出差單" }),
  ],
});

describe("表單管理:清單搜尋與選中的表單存在網址(REACT-14)", () => {
  it("搜尋(`?list=`)與選中的表單(`?detail=`)重新整理後都還在", async () => {
    const first = renderFormsPage(options());
    const list = await screen.findByRole("list", { name: "表單清單" });
    await first.user.click(within(list).getByText("出差單"));
    await first.user.type(screen.getByLabelText("搜尋表單"), "出差");
    await waitFor(() => {
      expect(urlJson("list")).toEqual({ keyword: "出差" });
    });
    expect(urlParam("detail")).toBe("trip");
    first.unmount();

    renderFormsPage(options(), FORMS_ALL, {}, currentSearch());

    expect(
      await screen.findByRole("heading", { name: "出差單" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("搜尋表單")).toHaveValue("出差");
  });
});
