import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * 排班表頁的測試查法(整頁測試共用)。
 *
 * 排班表整頁的 DOM 很大(一個月的格子 × 人):`screen.*ByRole` 要逐一算每個元素的角色與可及名稱,
 * 一次查詢就要上百毫秒到一秒多,CI 上整案會貼著 15 秒上限。整頁層級改用便宜的查法 ——
 * 文字 + selector、`aria-label`、角色屬性選擇器;進到對話框 / 面板這種小範圍後再用 `within(...).getByRole`。
 */

/** 不在每個事件之間讓出一輪計時器(`delay: null`)。 */
export const fastUser = () => userEvent.setup({ delay: null });

/** 頁面上的按鈕(依按鈕自己的文字)。 */
export const findButton = (text: string | RegExp) =>
  screen.findByText(text, { selector: "button" });

export const queryButton = (text: string | RegExp) =>
  screen.queryByText(text, { selector: "button" });

/** 以 `aria-label` 找(格子、人數標籤、日期欄 [⋯]、檢核面板)。 */
export const findLabelled = (label: string) => screen.findByLabelText(label);

const matches = (expected: string | RegExp, actual: string) =>
  typeof expected === "string" ? actual === expected : expected.test(actual);

/** 對話框的標題(`aria-labelledby` 指到的元素)。 */
const dialogTitleOf = (dialog: Element): string => {
  const id = dialog.getAttribute("aria-labelledby");
  return id === null
    ? ""
    : (document.querySelector(`#${CSS.escape(id)}`)?.textContent ?? "").trim();
};

export const queryDialog = (title: string | RegExp): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
    (dialog) => matches(title, dialogTitleOf(dialog)),
  ) ?? null;

/** 等到標題是 `title` 的對話框出現。 */
export const findDialog = (title: string | RegExp): Promise<HTMLElement> =>
  waitFor(() => {
    const dialog = queryDialog(title);
    if (dialog === null) {
      throw new Error(`找不到對話框:${String(title)}`);
    }
    return dialog;
  });

const findByRoleAttribute = (
  role: string,
  name: string,
): Promise<HTMLElement> =>
  waitFor(() => {
    const found = [
      ...document.querySelectorAll<HTMLElement>(`[role="${CSS.escape(role)}"]`),
    ].find((element) => element.textContent.trim() === name);
    if (found === undefined) {
      throw new Error(`找不到 ${role}:${name}`);
    }
    return found;
  });

/** 下拉選單的選項(MUI Select 的 `role="option"`)。 */
export const findOption = (name: string) => findByRoleAttribute("option", name);

/** 選單項目(`role="menuitem"`)。 */
export const findMenuItem = (name: string) =>
  findByRoleAttribute("menuitem", name);
