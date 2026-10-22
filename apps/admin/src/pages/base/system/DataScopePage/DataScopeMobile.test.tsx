import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderPage, waitForEditor } from "./data-scope-test-support";

const targets = () => screen.queryByRole("list", { name: "資料目標" });
const editorRegion = () => screen.queryByRole("region", { name: "規則編輯器" });
const findEditor = async () =>
  screen.findByRole("region", { name: "規則編輯器" });

describe("資料範圍:手機寬一次只顯示一邊(主從)", () => {
  restoreViewportAfterEach();

  it("目標清單滿版 → 點目標切到編輯器(網址帶選取)→ [← 返回] 回到清單;重新整理停在同一個目標", async () => {
    setMobileViewport();
    const first = renderPage();
    const list = await screen.findByRole("list", { name: "資料目標" });
    expect(editorRegion()).toBeNull();

    await first.user.click(
      await within(list).findByRole("button", { name: /示範表單\(頂層\)/ }),
    );
    await waitForEditor("示範表單(頂層)(form_submissions)");
    expect(targets()).toBeNull();
    const search = currentSearch();

    await first.user.click(screen.getByRole("button", { name: "← 返回" }));
    await waitFor(() => {
      expect(targets()).not.toBeNull();
    });
    expect(editorRegion()).toBeNull();
    expect(urlParam("detail")).toBeNull();
    first.unmount();

    renderPage({ search });
    await waitForEditor("示範表單(頂層)(form_submissions)");
  });

  it("sm 以上兩欄並排,沒有 [← 返回]", async () => {
    renderPage();
    await screen.findByRole("list", { name: "資料目標" });
    expect(await findEditor()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "← 返回" })).toBeNull();
  });
});
