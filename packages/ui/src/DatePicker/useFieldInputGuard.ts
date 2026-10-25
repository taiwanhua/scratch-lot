import type { CompositionEvent, SyntheticEvent } from "react";
import { useEffect, useRef } from "react";

/*
 * MUI X 9.14.0 的 bug 暫時處理,MUI 修正後移除(升級 `@mui/x-date-pickers` 時依下列重現檢查;
 * 登記在 `docs/concepts/frontend-architecture.md`「日期與時間的顯示」)。
 *
 * 欄位的每個區段是 `contenteditable` 的 span,MUI 在區段的 `onInput` 直接拿 `target.textContent` 當「按下的鍵」,
 * 套用後立刻用 `innerHTML` 把 DOM 改回去:
 * `@mui/x-date-pickers/internals/hooks/useField/useFieldSectionContentProps.mjs` 的 `handleInput`(9.14.0 第 60–93 行;
 * 全選時是同目錄 `useFieldRootProps.mjs` 的 `handleInput`,第 248 行起),數字判斷在 `useField.utils.mjs` 的 `isStringNumber`(第 93–97 行)。
 * 9.16.0(本文撰寫時 npm 最新版)這幾段相同。
 *
 * 1. 輸入法組字(IME composition):沒有看 `isComposing`、也不處理 `compositionend`。
 *    組字中的 `input` 套用一次、確認時再套用一次,每個數字變兩個(年份打 `2` 變 `0022`、打 `20` 變 `2200`);
 *    組字途中改寫 DOM 也會打斷輸入法。MUI issue:https://github.com/mui/mui-x/issues/9465(日文輸入法,同一根因)。
 * 2. 全形數字:`Number("２")` 是 `NaN`,被當成字母比對後丟掉,欄位打不進去。(同上 issue 的一部分)
 * 3. 空白:Chromium 在 `contenteditable` 打空白寫入的是 NBSP(U+00A0),`isStringNumber` 只排除 `' '`,
 *    `Number("\u00A0")` 是 `0`,空白被當成數字 0(日期時間打 `2026-11-03 18:30` 得到 01:30)。待回報 MUI。
 *
 * 做法:在欄位外層用 capture 階段的 handler 先攔(React 的 capture 比區段的 `onInput` 先跑),
 * 組字中的 `input` 不交給 MUI;確認後只把確認文字裡的數字(全形轉半形)逐位交給 MUI 一次;
 * 一般輸入先把全形數字轉半形、空白一律轉成 MUI 本來就會略過的 `' '`(與 `-`、`/`、`:` 一樣不改區段,
 * 區段打滿自然跳到下一段,所以 `2026-11-03 18:30` 與 `2026 11 03` 都照順序填進去)。
 */

// MUI X 9.14.0 的 bug 暫時處理(檔頭 2、3:全形數字、NBSP),MUI 修正後移除

/** 全形數字 → 半形 */
const toHalfWidthDigits = (text: string): string =>
  text.replaceAll(/[\uFF10-\uFF19]/gu, (char) =>
    String.fromCodePoint((char.codePointAt(0) ?? 0) - 0xfe_e0),
  );

/** 一般輸入的文字:全形數字轉半形;空白(NBSP、全形空白等)轉成 `' '`,只有空白時收成一個 `' '`。 */
export const normalizeFieldText = (text: string): string => {
  const normalized = toHalfWidthDigits(text).replaceAll(/\s/gu, " ");
  return normalized !== "" && normalized.trim() === "" ? " " : normalized;
};

/** 確認文字裡要交給 MUI 的數字(注音、漢字等非數字整個略過)。 */
const digitsOf = (text: string): string[] =>
  toHalfWidthDigits(text).match(/\d/gu) ?? [];

// MUI X 9.14.0 的 bug 暫時處理(檔頭 1:輸入法組字),MUI 修正後移除

/** 組字中的 `input`:各瀏覽器以 `isComposing` 或 composition 類的 `inputType` 標示。 */
const isCompositionInput = (event: InputEvent): boolean =>
  event.isComposing ||
  event.inputType === "insertCompositionText" ||
  event.inputType === "deleteCompositionText";

interface Composition {
  /** 組字開始時的可編輯元素(區段 span;全選時是整組的容器) */
  host: HTMLElement;
  /** 組字開始前的 DOM(MUI 認定的內容),確認或取消後改回去 */
  html: string;
  /** `compositionend` 帶來的確認文字 */
  data?: string;
}

/** 把元素內容整段選起來(MUI 選取區段時也是整段選) */
const selectContents = (element: HTMLElement) => {
  const selection = element.ownerDocument.getSelection();
  if (selection === null) {
    return;
  }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
};

/** 欄位內目前取得焦點的可編輯元素(MUI 每打滿一段就把焦點移到下一段) */
const activeEditableIn = (root: HTMLElement): HTMLElement | null => {
  const active = root.ownerDocument.activeElement;
  return active instanceof HTMLElement &&
    active !== root &&
    root.contains(active) &&
    active.getAttribute("contenteditable") === "true"
    ? active
    : null;
};

/** 這裡自己送出的 `input`(確認組字後交給 MUI 的數字):原樣交給 MUI,不再當成組字的確認 */
const replayedInputs = new WeakSet<Event>();

/** 模擬打一位數字:送出一個 `input`,MUI 依當時選取的區段處理、打滿才跳段 */
const typeDigit = (root: HTMLElement, digit: string): boolean => {
  const target = activeEditableIn(root);
  if (target === null) {
    return false;
  }
  const input = new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: digit,
  });
  replayedInputs.add(input);
  target.textContent = digit;
  target.dispatchEvent(input);
  return true;
};

/**
 * 日期 / 時間欄位的輸入攔截(見檔頭:MUI X 的組字、全形數字、NBSP 問題)。
 * 回傳的 handler 掛在 MUI picker 的 `slotProps.textField`(欄位最外層),三個包裝元件經 `usePickerDraft` 共用同一份。
 */
export const useFieldInputGuard = () => {
  const composition = useRef<Composition | null>(null);
  const pendingCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTyping = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      for (const timer of [pendingCommit.current, pendingTyping.current]) {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }
    },
    [],
  );

  /** 結束組字:DOM 改回 MUI 的內容,再把確認文字裡的數字逐位交給 MUI */
  const commit = (root: HTMLElement, data: string | null | undefined) => {
    const current = composition.current;
    composition.current = null;
    if (pendingCommit.current !== null) {
      clearTimeout(pendingCommit.current);
      pendingCommit.current = null;
    }
    if (current === null) {
      return;
    }
    if (current.host.isConnected) {
      current.host.innerHTML = current.html;
      if (current.host.ownerDocument.activeElement === current.host) {
        selectContents(current.host);
      }
    }
    const digits = digitsOf(data ?? "");
    if (digits.length === 0) {
      return;
    }
    // 每一位各排到下一輪才交給 MUI:此時多半還在 React 的事件處理中,
    // 每一位要等上一位處理完(狀態更新、打滿跳段、焦點移到下一段)才送
    const typeFrom = (index: number) => {
      pendingTyping.current = setTimeout(() => {
        pendingTyping.current = null;
        const digit = digits[index];
        if (digit !== undefined && typeDigit(root, digit)) {
          typeFrom(index + 1);
        }
      }, 0);
    };
    typeFrom(0);
  };

  const onCompositionStartCapture = (event: CompositionEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    if (composition.current !== null) {
      commit(event.currentTarget, composition.current.data);
    }
    composition.current = { host: event.target, html: event.target.innerHTML };
  };

  const onCompositionEndCapture = (event: CompositionEvent<HTMLElement>) => {
    const current = composition.current;
    if (current === null) {
      return;
    }
    current.data = event.data;
    // 有的瀏覽器在 `compositionend` 之後還會補一個確認用的 `input`(`insertText` / `insertFromComposition`):
    // 等到下一輪再確認,那個 `input` 先到就由它確認,同一次確認只交給 MUI 一次
    const root = event.currentTarget;
    pendingCommit.current = setTimeout(() => {
      pendingCommit.current = null;
      commit(root, current.data);
    }, 0);
  };

  const onInputCapture = (event: SyntheticEvent<HTMLElement>) => {
    const native = event.nativeEvent;
    if (
      !(native instanceof InputEvent) ||
      !(event.target instanceof HTMLElement) ||
      replayedInputs.has(native)
    ) {
      return;
    }
    // MUI X 9.14.0 的 bug 暫時處理(檔頭 1):組字中與確認用的 `input` 不讓 MUI 的 `handleInput` 看到
    if (isCompositionInput(native)) {
      // 組字中:不交給 MUI,DOM 留給輸入法
      event.stopPropagation();
      return;
    }
    if (composition.current !== null) {
      // 組字開始後的第一個非組字 `input`:確認(`insertText` 等,文字以它為準)或取消(刪除類)
      event.stopPropagation();
      const data = native.inputType.startsWith("insert")
        ? (native.data ?? composition.current.data)
        : undefined;
      commit(event.currentTarget, data);
      return;
    }
    // MUI X 9.14.0 的 bug 暫時處理(檔頭 2、3):MUI 讀 `textContent` 前先把全形數字、NBSP 換掉
    const text = event.target.textContent;
    const normalized = normalizeFieldText(text);
    if (normalized !== text) {
      event.target.textContent = normalized;
    }
  };

  return {
    onCompositionStartCapture,
    onCompositionEndCapture,
    onInputCapture,
  };
};
