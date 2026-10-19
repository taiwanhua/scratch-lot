"use client";

import MuiBox from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { mergeSx } from "../theme/sx";

export interface MarkdownProps {
  /** Markdown 原始碼(不是 HTML);原始碼裡的 raw HTML 一律不渲染。 */
  children: string;
  sx?: SxProps<Theme>;
}

/**
 * 排版節奏對 theme typography(Figma Draft/HelpDialog 95:235:標題 h6、小節標題 14px SemiBold、
 * 內文 13px 次要色)。Figma 的 13px 內文以 `body2`(14px)近似 — theme 沒有 13px 級,
 * 差 1px 視覺可接受(STYLE-06);小節標題對上 `subtitle2`(14px / 600)。
 * `& > :first-of-type` / `& > :last-child` 把首尾的外距收掉,讓容器自己決定內距。
 */
const markdownSx = {
  typography: "body2",
  color: "text.secondary",
  "& h1": { typography: "h6", color: "text.primary", mt: 2.5, mb: 1 },
  "& h2": { typography: "subtitle2", color: "text.primary", mt: 2, mb: 1 },
  "& h3, & h4, & h5, & h6": {
    typography: "subtitle2",
    color: "text.primary",
    mt: 1.5,
    mb: 0.75,
  },
  "& p": { my: 1 },
  "& ul, & ol": { my: 1, pl: 3 },
  "& li": { mb: 0.5 },
  "& li > p": { my: 0 },
  "& strong": { color: "text.primary", fontWeight: 600 },
  "& a": { color: "primary.main" },
  "& code": {
    typography: "caption",
    bgcolor: "action.hover",
    borderRadius: 1,
    px: 0.5,
    py: 0.25,
  },
  "& pre": {
    bgcolor: "action.hover",
    borderRadius: 1,
    p: 1.5,
    overflowX: "auto",
    "& code": { bgcolor: "transparent", p: 0 },
  },
  "& blockquote": {
    my: 1,
    ml: 0,
    pl: 2,
    borderLeft: 2,
    borderColor: "divider",
  },
  "& hr": { my: 2, border: 0, borderTop: 1, borderColor: "divider" },
  "& table": { width: "100%", my: 1.5, borderCollapse: "collapse" },
  "& th, & td": {
    border: 1,
    borderColor: "divider",
    px: 1.5,
    py: 0.75,
    textAlign: "left",
    verticalAlign: "top",
  },
  "& th": {
    typography: "subtitle2",
    color: "text.primary",
    bgcolor: "background.default",
  },
  "& > :first-of-type": { mt: 0 },
  "& > :last-child": { mb: 0 },
};

/**
 * 渲染一段 Markdown(GFM:表格、刪除線、工作清單;模組說明彈窗的內文)。
 *
 * **不允許 raw HTML**:沒有掛 `rehype-raw`,所以原始碼裡的 `<script>`、`<img onerror>` 這類標籤
 * 一律不會變成 DOM 節點 — 內容是文件(help.md)不是使用者輸入,但渲染端不該相信這件事。
 * 連結的 `href` 由 react-markdown 預設的 `urlTransform` 擋掉 `javascript:` 等協定。
 */
export const Markdown = ({ children, sx }: MarkdownProps) => (
  <MuiBox sx={mergeSx(markdownSx, sx)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
  </MuiBox>
);
