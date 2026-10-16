import { screen, waitFor } from "@testing-library/react";

import type { SnackbarSeverity } from "@repo/ui/snackbar";

/**
 * 全站短提示(#376、底座規格 10.12)的查詢 helper。
 *
 * **要用容器收斂,不能只 `findByText`**:失敗提示與頁面 / 彈窗上那一條錯誤是**同一份
 * 文案**(刻意的:同一份錯誤解讀),只比文字會同時抓到兩個節點,也證明不了提示真的跳了。
 * 提示堆疊(`@repo/ui/snackbar` 的 `SnackbarStack`)以 `data-snackbar-stack` 標記容器,
 * 每一則是一個 MUI Alert(`.MuiAlert-root`,同 TEST-09「驗樣式直接讀 MUI / emotion 產出的東西」的取捨)。
 * 堆疊會往上疊(新的在最下面),所以「這次操作的那一則」= 容器裡的**最後一則**。
 */
const stackRoot = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-snackbar-stack]");

/** 等提示出現,回傳堆疊容器(在裡面再用 `within` 找 alert / 關閉鈕)。 */
export const findSnackbar = async (): Promise<HTMLElement> =>
  waitFor(() => {
    const root = stackRoot();
    if (root === null) {
      throw new Error("Snackbar 還沒出現");
    }
    return root;
  });

/** 等提示出現,回傳最新(最下面)那一則的卡片。 */
export const findLatestSnackbar = async (): Promise<HTMLElement> => {
  const root = await findSnackbar();
  const latest = [...root.querySelectorAll<HTMLElement>(".MuiAlert-root")].at(
    -1,
  );
  if (latest === undefined) {
    throw new Error("堆疊裡沒有任何一則");
  }
  return latest;
};

/**
 * 螢幕閱讀器念得到的那一份文案(#430):沒有彈窗時是那一則自己的 `role="alert"`;
 * **彈窗開著時** app 根節點被 MUI 的 modal manager 標了 `aria-hidden`,alert 在無障礙樹上
 * 不存在,改由 `SnackbarProvider` 補的 `role="status"` 區域念(只念最新一則)。兩個查詢都
 * **不帶 `hidden: true`** —— 這個 helper 本身就是「提示念得到」的斷言,念不到就逾時失敗。
 */
const announcedTextOf = async (card: HTMLElement): Promise<string> => {
  // 卡片本身就是 `role="alert"`;被 aria-hidden 藏起來時不在無障礙樹上,這裡就找不到它
  if (screen.queryAllByRole("alert").includes(card)) {
    return card.textContent;
  }
  return waitFor(() => {
    const text = screen.getByRole("status").textContent;
    if (text === "") {
      throw new Error("status 區域還沒填字");
    }
    return text;
  });
};

const SEVERITIES: readonly SnackbarSeverity[] = [
  "success",
  "error",
  "warning",
  "info",
];

const severityOf = (card: HTMLElement): SnackbarSeverity =>
  SEVERITIES.find((severity) =>
    card.classList.contains(
      `MuiAlert-color${severity.charAt(0).toUpperCase()}${severity.slice(1)}`,
    ),
  ) ?? "success";

/**
 * 等提示出現並回傳**最新那一則**的文字與語氣(取自 MUI Alert 的 `MuiAlert-color*` class)。
 * 文字取的是**螢幕閱讀器念得到的那一份**(`announcedTextOf`),彈窗開著時也一樣。
 */
export const findSnackbarAlert = async (): Promise<{
  text: string;
  severity: SnackbarSeverity;
}> => {
  const card = await findLatestSnackbar();
  return {
    text: await announcedTextOf(card),
    severity: severityOf(card),
  };
};

/** 這次操作不該跳提示(dry-run / 預覽那一類)。 */
export const querySnackbar = (): HTMLElement | null => stackRoot();
