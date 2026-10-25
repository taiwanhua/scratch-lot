import { act, fireEvent } from "@testing-library/react";

/**
 * 日期 / 時間欄位(MUI X 的 `contenteditable` 區段)的低階輸入模擬:userEvent 不會產生輸入法組字,
 * 也不會像 Chromium 那樣把空白寫成 NBSP,這裡照瀏覽器實際的事件順序與 DOM 變化送事件。
 * 一律打在目前取得焦點的區段(先 `user.click` 區段)。
 */

const focused = (): HTMLElement => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    throw new TypeError("沒有取得焦點的區段");
  }
  return active;
};

/** 瀏覽器把 `text` 寫進區段後送出 `input`(區段整段選取時,打字會取代整段內容) */
const writeAndInput = (
  target: HTMLElement,
  text: string,
  init: { inputType: string; isComposing?: boolean },
) => {
  target.textContent = text;
  fireEvent(
    target,
    new InputEvent("input", { bubbles: true, data: text, ...init }),
  );
};

/** 讓欄位排到之後幾輪的處理(確認組字、再逐位交給 MUI,每位一輪)跑完:一輪一輪等,不靠固定毫秒數 */
const flushTimers = (rounds: number) =>
  act(async () => {
    for (let round = 0; round < rounds; round += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  });

/** 一般打字但寫進 DOM 的是 `text` 本身(例:Chromium 打空白寫成 NBSP、全形模式直接送出全形數字) */
export const typeRaw = (text: string) => {
  for (const char of text) {
    writeAndInput(focused(), char, { inputType: "insertText" });
  }
};

/**
 * 輸入法組字後確認成 `committed`(注音輸入法打數字、或選字)。
 * - `"compositionend"`:Chrome / Edge 的順序 —— 組字中的 `input`(`isComposing`)→ `compositionend`,確認不再補 `input`
 * - `"insertText"`:另一種順序(CDP `Input.insertText` 模擬、部分瀏覽器)—— 組字中的 `input` → 確認用的一般 `input`,沒有 `compositionend`
 */
export const compose = async (
  committed: string,
  commitWith: "compositionend" | "insertText" = "compositionend",
) => {
  const target = focused();
  fireEvent.compositionStart(target, { data: target.textContent });
  fireEvent.compositionUpdate(target, { data: committed });
  writeAndInput(target, committed, {
    inputType: "insertCompositionText",
    isComposing: true,
  });
  if (commitWith === "compositionend") {
    fireEvent.compositionEnd(target, { data: committed });
  } else {
    writeAndInput(target, committed, { inputType: "insertText" });
  }
  await flushTimers(committed.length + 2);
};

/** 每個字各自組字、確認一次(注音輸入法逐鍵打數字) */
export const composeEach = async (
  text: string,
  commitWith: "compositionend" | "insertText" = "compositionend",
) => {
  for (const char of text) {
    await compose(char, commitWith);
  }
};
