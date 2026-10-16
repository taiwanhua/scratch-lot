import { describe, expect, it } from "@jest/globals";
import { waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";

import {
  renderPage,
  targetList,
  waitForEditor,
} from "./data-scope-test-support";

describe("資料範圍:選中的資料目標存在網址(REACT-14)", () => {
  it("選中的目標寫進 `?detail=`;重新整理後編輯器還是那一個目標", async () => {
    const first = renderPage();
    await waitForEditor("示範模組1(demo_items_one)");
    await first.user.click(
      within(targetList()).getByRole("button", { name: /示範表單\(頂層\)/ }),
    );
    await waitForEditor("示範表單(頂層)(form_submissions)");
    await waitFor(() => {
      expect(urlParam("detail")).not.toBeNull();
    });
    first.unmount();

    renderPage({ search: currentSearch() });

    await waitForEditor("示範表單(頂層)(form_submissions)");
  });
});
