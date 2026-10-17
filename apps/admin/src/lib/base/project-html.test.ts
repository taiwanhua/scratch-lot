import { describe, expect, it } from "@jest/globals";

import { projectPublic } from "@repo/project-config/public";

import {
  applyDocumentTitle,
  escapeHtmlText,
  projectDocumentTitle,
  projectHtmlTransform,
} from "./project-html";

/** 與 `index.html` / `mock.html` 同形狀的入口(實檔的接線由 build 產物與 mock server 驗)。 */
const APP_ENTRY = `<!DOCTYPE html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title></title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
`;

const MOCK_ENTRY = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <!-- 空 data URI:mock 模式不服務 public/,省掉一次 favicon 404 -->
    <link rel="icon" href="data:," />
    <title></title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/mock/main.tsx"></script>
  </body>
</html>
`;

const TITLE_ELEMENT = /<title>[\s\S]*?<\/title>/;

/** 瀏覽器實際讀到的頁面標題:交給 HTML 解析器解回文字,不經受測的跳脫函式。 */
const parsedTitleOf = (html: string): string =>
  new DOMParser().parseFromString(html, "text/html").title;

describe("project-html:HTML title 由專案設定寫入", () => {
  // 正式接線讀目前的專案設定;這兩案不寫任何專案的字面值,換專案不必改
  it("正式入口:瀏覽器讀到的 title 就是專案設定的 documentTitle", () => {
    expect(parsedTitleOf(projectHtmlTransform("app")(APP_ENTRY))).toBe(
      projectPublic.admin.documentTitle,
    );
  });

  it("mock 入口:同一個 title 後面加(mock)", () => {
    expect(parsedTitleOf(projectHtmlTransform("mock")(MOCK_ENTRY))).toBe(
      `${projectPublic.admin.documentTitle}(mock)`,
    );
  });

  it("固定的 CookHome title:寫進 HTML 的內容與抽設定前的原始檔逐字相同", () => {
    expect(
      applyDocumentTitle(
        "<title></title>",
        projectDocumentTitle("app", "CookHome 後台管理"),
      ),
    ).toBe("<title>CookHome 後台管理</title>");
    expect(
      applyDocumentTitle(
        "<title></title>",
        projectDocumentTitle("mock", "CookHome 後台管理"),
      ),
    ).toBe("<title>CookHome 後台管理(mock)</title>");
  });

  it("只換 title:mock 的空 favicon 與其餘內容原樣保留", () => {
    const html = projectHtmlTransform("mock")(MOCK_ENTRY);

    expect(html).toContain('<link rel="icon" href="data:," />');
    expect(html.replace(TITLE_ELEMENT, "")).toBe(
      MOCK_ENTRY.replace(TITLE_ELEMENT, ""),
    );
  });

  it("純文字 title 寫進 HTML 前跳脫特殊字元", () => {
    expect(escapeHtmlText(`A&B <b>"x"</b> 'y'`)).toBe(
      "A&amp;B &lt;b&gt;&quot;x&quot;&lt;/b&gt; &#39;y&#39;",
    );
    expect(
      applyDocumentTitle(
        "<head><title></title></head>",
        "</title><script>alert(1)</script>",
      ),
    ).toBe(
      "<head><title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title></head>",
    );
  });

  it("title 裡的 `$&` 這類取代樣式字元照字面寫入", () => {
    expect(applyDocumentTitle("<title>old</title>", "Cost $& $1")).toBe(
      "<title>Cost $&amp; $1</title>",
    );
  });

  it("HTML 沒有 title 元素時明確失敗,不靜默略過", () => {
    expect(() => applyDocumentTitle("<head></head>", "X")).toThrow(/title/);
  });

  it("替代品牌輸入:兩種入口都跟著換", () => {
    expect(projectDocumentTitle("app", "Acme Admin")).toBe("Acme Admin");
    expect(projectDocumentTitle("mock", "Acme Admin")).toBe("Acme Admin(mock)");
  });
});
