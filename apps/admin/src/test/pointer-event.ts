import { afterAll, beforeAll } from "@jest/globals";

/**
 * jsdom 沒有 `PointerEvent`:`fireEvent.pointerDown` 退回一般 `Event`,`pointerType` / 座標都帶不進去。
 * 要測觸控(長按、`pointerType`)的測試檔在頂層呼叫一次:測試期間補一個以 `MouseEvent` 為底的替身
 * (座標來自 MouseEvent,`pointerType` 自己帶),結束還原。
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "";
  }
}

export const setupPointerEvent = (): void => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "PointerEvent");
  beforeAll(() => {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      writable: true,
      value: TestPointerEvent,
    });
  });
  afterAll(() => {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, "PointerEvent");
    } else {
      Object.defineProperty(globalThis, "PointerEvent", original);
    }
  });
};
