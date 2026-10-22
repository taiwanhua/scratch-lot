import { describe, expect, it } from "@jest/globals";

import { REDEMPTION_SERIAL_FORMAT } from "@repo/domain/project/lottery";

import { projectSeedSource } from "./registry";

/** 專案受管表單的單號前綴(規格第 8 章共通「單號」)。 */
describe("受管表單的單號前綴", () => {
  const prefixes = projectSeedSource.seeds.flatMap((seed) =>
    seed.kind === "form-definition" && seed.serial !== undefined
      ? [{ key: seed.key, prefix: seed.serial.prefix }]
      : [],
  );

  it("每張表單的前綴都不一樣,也不和兌獎紀錄的 RD 撞(看單號就知道是哪一種單)", () => {
    const all = [
      ...prefixes.map((entry) => entry.prefix),
      REDEMPTION_SERIAL_FORMAT.prefix,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("目前的前綴", () => {
    expect(
      Object.fromEntries(prefixes.map((entry) => [entry.key, entry.prefix])),
    ).toEqual({
      requisition: "R",
      purchase: "P",
      transfer: "T",
      sale_reversal: "SR",
      cash_correction: "X",
      stocktake_confirm: "ST",
      checkout_confirm: "C",
      makeup_punch: "M",
      support_request: "SP",
    });
  });
});
