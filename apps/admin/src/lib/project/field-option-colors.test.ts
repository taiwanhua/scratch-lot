import { describe, expect, it } from "@jest/globals";

import { indexFieldOptionColors } from "./field-option-colors";

describe("indexFieldOptionColors", () => {
  it("依選項 id 與值各建一張查表", () => {
    const { byFieldId, byValue } = indexFieldOptionColors([
      { fieldId: "f-1", value: "restock", paletteKey: "orange" },
    ]);
    expect(byFieldId.get("f-1")).toBe("orange");
    expect(byValue.get("restock")).toBe("orange");
  });

  it("同一個值有兩筆、顏色不同:byValue 不猜(當沒有顏色),byFieldId 各自照舊", () => {
    const { byFieldId, byValue } = indexFieldOptionColors([
      { fieldId: "f-own", value: "booth", paletteKey: "blue" },
      { fieldId: "f-lower", value: "booth", paletteKey: "red" },
    ]);
    expect(byValue.has("booth")).toBe(false);
    expect(byFieldId.get("f-own")).toBe("blue");
    expect(byFieldId.get("f-lower")).toBe("red");
  });

  it("同一個值兩筆同色:照常查得到", () => {
    const { byValue } = indexFieldOptionColors([
      { fieldId: "f-a", value: "booth", paletteKey: "green" },
      { fieldId: "f-b", value: "booth", paletteKey: "green" },
    ]);
    expect(byValue.get("booth")).toBe("green");
  });

  it("認不得的代號(色碼、null)當沒有顏色", () => {
    const { byFieldId, byValue } = indexFieldOptionColors([
      { fieldId: "f-1", value: "a", paletteKey: "#FFA500" },
      { fieldId: "f-2", value: "b", paletteKey: null },
    ]);
    expect(byFieldId.size).toBe(0);
    expect(byValue.size).toBe(0);
  });
});
