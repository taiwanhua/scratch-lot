import { describe, expect, it } from "@jest/globals";

import { FieldManagerWithColorPage } from "@/pages/project/system/FieldManagerWithColorPage/FieldManagerWithColorPage";

import { modulePages } from "../module-pages";

/** 專案對底座頁的替換,經固定組裝入口生效(登記解除後的行為見 `FieldManagerReplacementRemoved.test.tsx`)。 */
describe("專案的客製替換", () => {
  it("`system.field-manager` 換成帶「顏色」欄的客製頁(規格 18.5)", () => {
    expect(modulePages["system.field-manager"]).toBe(FieldManagerWithColorPage);
  });
});
