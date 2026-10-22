import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { currentSearch, urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import {
  renderPage,
  targetList,
  waitForEditor,
} from "./data-scope-test-support";

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

const removeButtons = () =>
  screen.queryAllByRole("button", { name: "刪除規則" });

describe("資料範圍:未存變更與同一筆", () => {
  restoreViewportAfterEach();

  it("手機寬:預設那一筆有未存變更 → [← 返回] 先問 → 放棄 → 再點進去是原本的規則", async () => {
    setMobileViewport();
    const { user } = renderPage();
    const list = await screen.findByRole("list", { name: "資料目標" });
    await user.click(
      await within(list).findByRole("button", { name: /示範模組1/ }),
    );
    await waitForEditor("示範模組1(demo_items_one)");
    const original = removeButtons().length;
    await user.click(screen.getByRole("button", { name: "+ 新增規則" }));
    expect(removeButtons()).toHaveLength(original + 1);

    await user.click(screen.getByRole("button", { name: "← 返回" }));
    expect(await screen.findByText("放棄未儲存的變更?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放棄變更" }));
    await waitFor(() => {
      expect(targets()).not.toBeNull();
    });
    expect(urlParam("detail")).toBeNull();

    await user.click(
      within(targetList()).getByRole("button", { name: /示範模組1/ }),
    );
    await waitForEditor("示範模組1(demo_items_one)");
    expect(removeButtons()).toHaveLength(original);
  });

  it("sm 以上:網址沒有選取、正在改預設那一筆時再點同一筆 → 不跳攔截、草稿留著,只把選取寫進網址", async () => {
    const { user } = renderPage();
    await waitForEditor("示範模組1(demo_items_one)");
    const original = removeButtons().length;
    await user.click(screen.getByRole("button", { name: "+ 新增規則" }));

    await user.click(
      within(targetList()).getByRole("button", { name: /示範模組1/ }),
    );
    await waitFor(() => {
      expect(urlParam("detail")).not.toBeNull();
    });
    expect(screen.queryByText("放棄未儲存的變更?")).toBeNull();
    expect(removeButtons()).toHaveLength(original + 1);
  });
});
