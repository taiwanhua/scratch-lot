import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, within } from "@testing-library/react";

import { injectScan } from "@/hooks/base/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/** 看板刷到批售中的張(專案規格 21.5、21.9 #3;Figma ST-05e-2、CS-06-2)。 */
describe("刷到批售中的張", () => {
  beforeEach(() => {
    writeLocalCashPoint(STORE_A, "cp-counter");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("擋下並寫批售單單號,不售出", async () => {
    const { salesFake } = renderStore({
      sales: { wholesalingTicketIds: ["b-1-t98"] },
    });
    await screen.findByRole("heading", { name: "店內櫃台" });
    act(() => {
      injectScan("0056527098");
    });
    const blocked = await screen.findByRole("dialog", { name: "不能銷售" });
    expect(
      within(blocked).getByText("這張刮刮樂在批售單 #W-0001,不能賣。"),
    ).toBeInTheDocument();
    expect(salesFake.inputs.sell).toEqual([]);
  });
});
