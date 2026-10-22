import { expect } from "@jest/globals";
import { screen } from "@testing-library/react";

/**
 * 依名稱取按鈕,斷言它們在 DOM 裡由左到右(文件順序)就是這個順序(REACT-16 的按鈕位置)。
 * 只比相對順序,中間夾了別的按鈕不影響;回傳取到的按鈕,呼叫端可再驗 variant。
 */
export const expectButtonOrder = (
  names: readonly (string | RegExp)[],
  container: Pick<typeof screen, "getByRole"> = screen,
): HTMLElement[] => {
  const buttons = names.map((name) => container.getByRole("button", { name }));
  let previous: HTMLElement | null = null;
  for (const button of buttons) {
    if (previous !== null) {
      expect(
        previous.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    previous = button;
  }
  return buttons;
};
