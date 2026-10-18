import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import {
  SAMPLE_TWO_ROUTES,
  renderSampleTwo,
} from "./demo-sample-two-test-support";

/**
 * 示範模組2 的路由防守(ADR-0011「可進 = 有那個模組路由」,僅此一條)。
 *
 * 與示範模組1 同一套機制(`matchModuleRoute` 只對 hidden 模組容許尾端一段動態參數),
 * 這裡確認它**不是綁在某一個模組上的特例** —— 換一個模組樹照樣成立。
 * 差別:示範模組2 掛在示範群組直下,網址少一層。
 */
describe("示範模組2 的路由防守", () => {
  it("綁了詳情頁:`/view-page/<id>` 進得去,殼的標題是那一頁的模組名", async () => {
    renderSampleTwo({ path: `${SAMPLE_TWO_ROUTES.viewPage}/demo-two-1` });

    expect(
      await screen.findByRole("heading", { name: "對照組項目A" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("詳情")).toBeInTheDocument();
  });

  it("沒綁詳情頁:同一個網址是殼的無權限頁", async () => {
    renderSampleTwo({
      path: `${SAMPLE_TWO_ROUTES.viewPage}/demo-two-1`,
      pages: ["list", "createPage", "editPage"],
    });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("沒綁新增頁:`/create-page` 是無權限頁(有 create 權限也一樣)", async () => {
    renderSampleTwo({
      path: SAMPLE_TWO_ROUTES.createPage,
      pages: ["list", "viewPage", "editPage"],
    });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("沒綁編輯頁:`/edit-page/<id>` 是無權限頁", async () => {
    renderSampleTwo({
      path: `${SAMPLE_TWO_ROUTES.editPage}/demo-two-1`,
      pages: ["list", "viewPage", "createPage"],
    });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("列表頁後面多接一段不算命中(退路只給隱藏頁)", async () => {
    renderSampleTwo({ path: `${SAMPLE_TWO_ROUTES.list}/demo-two-1` });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("有 create 權限但沒綁新增頁:列表上也沒有新增鈕(進不去的頁不給入口)", async () => {
    renderSampleTwo({ pages: ["list", "viewPage", "editPage"] });

    expect(await screen.findByText("對照組項目A")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增示範項目" }),
    ).not.toBeInTheDocument();
  });
});
