import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import {
  SAMPLE_ONE_ROUTES,
  renderSampleOne,
} from "./demo-sample-one-test-support";

/**
 * 示範模組1 的路由防守(ADR-0011「可進 = 有那個模組路由」,僅此一條)。
 *
 * 三個隱藏頁各是一個模組,`me.modules` 沒有它就進不去 —— 這是「隱藏頁模組 = 路由防守」
 * 的示範,也是這組頁面存在的理由之一。詳情 / 編輯的網址尾端還帶一段識別碼,
 * 由 `matchModuleRoute` 認出來(link 頁後面接一段仍然要擋)。
 */
describe("示範模組1 的路由防守", () => {
  it("綁了詳情頁:`/view-page/<id>` 進得去,殼的標題是那一頁的模組名", async () => {
    renderSampleOne({ path: `${SAMPLE_ONE_ROUTES.viewPage}/demo-1` });

    expect(
      await screen.findByRole("heading", { name: "醬燒雞腿排" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("示範項目詳情")).toBeInTheDocument();
  });

  it("沒綁詳情頁:同一個網址是殼的無權限頁", async () => {
    renderSampleOne({
      path: `${SAMPLE_ONE_ROUTES.viewPage}/demo-1`,
      pages: ["list", "createPage", "editPage"],
    });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("沒綁新增頁:`/create-page` 是無權限頁(有 create 權限也一樣)", async () => {
    renderSampleOne({
      path: SAMPLE_ONE_ROUTES.createPage,
      pages: ["list", "viewPage", "editPage"],
    });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("沒綁編輯頁:`/edit-page/<id>` 是無權限頁", async () => {
    renderSampleOne({
      path: `${SAMPLE_ONE_ROUTES.editPage}/demo-1`,
      pages: ["list", "viewPage", "createPage"],
    });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("列表頁後面多接一段不算命中(退路只給隱藏頁)", async () => {
    renderSampleOne({ path: `${SAMPLE_ONE_ROUTES.list}/demo-1` });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
  });

  it("隱藏頁少了識別碼那一段時,照樣進得去(新增頁本來就沒有識別碼)", async () => {
    renderSampleOne({ path: SAMPLE_ONE_ROUTES.createPage });

    expect(
      await screen.findByRole("heading", { name: "新增示範項目" }),
    ).toBeInTheDocument();
  });
});
