import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { projectHtmlTransform } from "@/lib/base/project-html";
import { authHandlers, authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { primaryMainOf } from "@/test/primary-color";
import { renderApp } from "@/test/render";

/**
 * 以固定的 CookHome 設定跑(jest 的 `legacy-project`):抽出專案設定前的畫面輸出逐字寫死在這裡,
 * 經正式的 AppProviders / Vite title 處理接線後必須一模一樣。與目前的專案值檔填什麼無關。
 */
describe("CookHome 原輸出:品牌名、頁腳、fallback、主色與 HTML title", () => {
  it("登入頁顯示「CookHome」,頁腳帶同一個品牌名", async () => {
    server.use(...authHandlers());

    renderApp({ path: "/login" });

    expect(
      await screen.findByRole("heading", { name: "CookHome" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `© ${String(new Date().getFullYear())} CookHome · 僅供授權人員使用`,
      ),
    ).toBeInTheDocument();
  });

  it("沒有當前組織時,側欄頂部退回「CookHome」", async () => {
    server.use(...authWorld({ hasRefreshCookie: true, orgs: [] }).handlers);

    renderApp({ path: "/" });
    const nav = await screen.findByRole("navigation", { name: "主選單" });

    expect(within(nav).getByText("CookHome")).toBeInTheDocument();
  });

  it("主題主色是 #FB7B10", async () => {
    server.use(...authHandlers());

    renderApp({ path: "/login" });
    await screen.findByRole("heading", { name: "CookHome" });

    expect(primaryMainOf(document)).toBe("#FB7B10");
  });

  it("HTML title:正式入口「CookHome 後台管理」,mock 入口加(mock)", () => {
    const entry = "<head><title></title></head>";

    expect(projectHtmlTransform("app")(entry)).toBe(
      "<head><title>CookHome 後台管理</title></head>",
    );
    expect(projectHtmlTransform("mock")(entry)).toBe(
      "<head><title>CookHome 後台管理(mock)</title></head>",
    );
  });
});
