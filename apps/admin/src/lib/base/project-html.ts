import { projectPublic } from "@repo/project-config/public";

/**
 * HTML 入口的品牌 title(兩支 Vite 設定共用):`index.html` / `mock.html` 的 `<title>` 留空,
 * 由 `transformIndexHtml` 寫入專案設定的 `admin.documentTitle`,值只有專案設定一份。
 */

/** `app` = 正式入口(`index.html`);`mock` = mock 開發模式(`mock.html`),title 後面加(mock)。 */
export type ProjectHtmlVariant = "app" | "mock";

const MOCK_TITLE_SUFFIX = "(mock)";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 純文字寫進 HTML 前跳脫;設定裡的 title 是純文字,不是 HTML 片段。 */
export const escapeHtmlText = (value: string): string =>
  value.replaceAll(/["&'<>]/g, (char) => HTML_ESCAPES[char] ?? char);

export const projectDocumentTitle = (
  variant: ProjectHtmlVariant,
  documentTitle: string = projectPublic.admin.documentTitle,
): string =>
  variant === "mock" ? `${documentTitle}${MOCK_TITLE_SUFFIX}` : documentTitle;

const TITLE_ELEMENT = /<title>[\s\S]*?<\/title>/;

/** 把 html 的 `<title>` 換成(跳脫後的)指定文字;找不到 title 元素就失敗,不讓頁面靜默沒有標題。 */
export const applyDocumentTitle = (html: string, title: string): string => {
  if (!TITLE_ELEMENT.test(html)) {
    throw new Error("HTML 入口缺少 <title> 元素,無法寫入專案的頁面標題");
  }
  // 以函式回傳取代內容:title 裡的 `$&`、`$1` 照字面寫入,不當取代樣式
  return html.replace(
    TITLE_ELEMENT,
    () => `<title>${escapeHtmlText(title)}</title>`,
  );
};

/** 給 Vite `transformIndexHtml` 的 handler:寫入專案設定的 title。 */
export const projectHtmlTransform =
  (variant: ProjectHtmlVariant) =>
  (html: string): string =>
    applyDocumentTitle(html, projectDocumentTitle(variant));
