import { describe, expect, it } from "@jest/globals";

import {
  type TransferCell,
  blockedGroupsOf,
  transferCellProblemOf,
  transferCellStateOf,
} from "./transfer-cells";

const cell = (
  overrides: Partial<TransferCell> & Pick<TransferCell, "state">,
): TransferCell => ({
  __typename: "LotteryTransferTicketCell",
  ticketNo: "041",
  unmatched: false,
  matchable: false,
  soldCashPointName: null,
  soldAt: null,
  cashPointName: null,
  lockedRefType: null,
  lockedSerialNo: null,
  ...overrides,
});
const clock = () => "";
const onTransfer = cell({
  state: "locked",
  lockedRefType: "transfer",
  lockedSerialNo: "T-0001",
});
const onWholesale = cell({
  state: "locked",
  lockedRefType: "wholesale",
  lockedSerialNo: "W-0001",
});

describe("調貨選張:批售中、已批售(規格 21.5)", () => {
  it("格子變體", () => {
    expect(transferCellStateOf(onTransfer)).toBe("transferring");
    expect(transferCellStateOf(onWholesale)).toBe("wholesaling");
    expect(transferCellStateOf(cell({ state: "wholesaled" }))).toBe(
      "wholesaled",
    );
  });

  it("不能調的原因寫哪一張單", () => {
    expect(transferCellProblemOf(onTransfer, clock)?.key).toBe(
      "cellProblems.locked",
    );
    expect(transferCellProblemOf(onWholesale, clock)).toMatchObject({
      key: "cellProblems.lockedWholesale",
      values: { serialNo: "W-0001" },
    });
    expect(
      transferCellProblemOf(cell({ state: "wholesaled" }), clock)?.key,
    ).toBe("cellProblems.wholesaled");
    expect(blockedGroupsOf(["041"], [onWholesale])).toEqual([
      { state: "lockedWholesale", ranges: "#041" },
    ]);
  });
});
