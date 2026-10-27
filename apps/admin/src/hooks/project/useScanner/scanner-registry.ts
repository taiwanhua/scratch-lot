import { ScannerDetector } from "./scanner-detector";

/**
 * B10 全域掃描監聽的登記與分派(專案規格 18.3「攔截」「用途」「測試」):
 *
 * - 頁面用 `useScanner(purpose, handler)` 宣告;**目前打開的頁面優先**(最後掛上的頁面在最上面)
 * - 沒有頁面宣告時,交給專案登記的**預設處理**(`registerDefaultScanHandler`;刮刮樂登記「快速銷售」)
 * - 游標在一般輸入框時也攔截(讀到的碼不留在輸入框);只有標記 `data-scanner-field` 的輸入框交給輸入框處理
 * - 測試與相機掃描可以用 `injectScan(code)` 直接送一次掃描(和條碼槍走同一條分派)
 *
 * 有任何登記時才在 `globalThis` 掛一個 keydown 監聽(capture 階段),全部撤銷後拆掉。
 */

/** 掃描從哪裡來:條碼槍(鍵盤)/ 注入(測試、相機)。 */
export type ScanSource = "keyboard" | "injected";

export interface ScanEvent {
  /** 讀到的碼(原樣;解析由處理者做,刮刮樂用 `parseTicketInput`)。 */
  code: string;
  source: ScanSource;
  /** 處理它的頁面宣告的用途;交給預設處理時為 null。 */
  purpose: string | null;
}

export type ScanHandler = (event: ScanEvent) => void;

interface PageRegistration {
  id: number;
  purpose: string;
  handler: ScanHandler;
}

/** 輸入框標記:有這個屬性(在自己或祖先上)的輸入框自己處理掃描。 */
export const SCANNER_FIELD_ATTRIBUTE = "data-scanner-field";
const SCANNER_FIELD_SELECTOR = "[data-scanner-field]";

let sequence = 0;
const pages: PageRegistration[] = [];
let defaultHandler: ScanHandler | null = null;
const detector = new ScannerDetector();
/** 這一段輸入開始時的輸入框與原值(確認是掃描後還原,讀到的碼不留在輸入框)。 */
let pendingField: {
  element: HTMLInputElement | HTMLTextAreaElement;
  value: string;
} | null = null;
let listening = false;

const dispatch = (code: string, source: ScanSource): boolean => {
  const page = pages.at(-1);
  if (page) {
    page.handler({ code, source, purpose: page.purpose });
    return true;
  }
  if (defaultHandler) {
    defaultHandler({ code, source, purpose: null });
    return true;
  }
  return false;
};

const isScannerField = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(SCANNER_FIELD_SELECTOR) !== null;

const editableOf = (
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | null =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target
    : null;

/** 把輸入框改回原值,並發出 input 事件(受控元件的 state 跟著回去)。 */
const restoreField = (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void => {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

const onKeyDown = (event: KeyboardEvent): void => {
  if (isScannerField(event.target) || event.isComposing) {
    detector.reset();
    pendingField = null;
    return;
  }
  const detected = detector.feed(event.key, Date.now());
  if (detector.isFresh) {
    const field = editableOf(event.target);
    pendingField = field ? { element: field, value: field.value } : null;
  }
  if (detected === null) {
    return;
  }
  const field = pendingField;
  pendingField = null;
  if (!dispatch(detected.code, "keyboard")) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (field && field.element.value !== field.value) {
    restoreField(field.element, field.value);
  }
};

const syncListener = (): void => {
  const needed = pages.length > 0 || defaultHandler !== null;
  if (needed && !listening) {
    globalThis.addEventListener("keydown", onKeyDown, { capture: true });
    listening = true;
  } else if (!needed && listening) {
    globalThis.removeEventListener("keydown", onKeyDown, { capture: true });
    listening = false;
    detector.reset();
    pendingField = null;
  }
};

/** 頁面宣告用途(`useScanner` 內部用);回撤銷函式。 */
export const registerPageScanHandler = (
  purpose: string,
  handler: ScanHandler,
): (() => void) => {
  sequence += 1;
  const registration: PageRegistration = { id: sequence, purpose, handler };
  pages.push(registration);
  syncListener();
  return () => {
    const index = pages.findIndex((page) => page.id === registration.id);
    if (index !== -1) {
      pages.splice(index, 1);
    }
    syncListener();
  };
};

/**
 * 專案登記的預設處理(沒有頁面宣告用途時;刮刮樂的快速銷售由店面票登記)。
 * 只有一個:再登記會換掉前一個。回撤銷函式。
 */
export const registerDefaultScanHandler = (
  handler: ScanHandler,
): (() => void) => {
  defaultHandler = handler;
  syncListener();
  return () => {
    if (defaultHandler === handler) {
      defaultHandler = null;
    }
    syncListener();
  };
};

/** 注入一次掃描(測試、相機掃描):和條碼槍同一條分派;沒有任何處理者時回 false。 */
export const injectScan = (code: string): boolean => dispatch(code, "injected");
