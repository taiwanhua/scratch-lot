import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";
import { HttpResponse } from "msw";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  sampleOutstanding,
  settlementOf,
} from "@/test/msw/project/lottery/accounts-fixtures";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { SettlementPanel } from "./SettlementPanel";

const MODULE_KEY = "purchasing.wholesale";

/** 批售單(只有出貨店收款方一邊)的結算區塊。 */
const renderWholesale = (net: number) => {
  const [row] = sampleOutstanding();
  const due = 37_200 - net;
  const settlement = settlementOf({
    ...row,
    moduleKey: MODULE_KEY,
    label: "批售單",
    side: "shipper",
    sideLabel: "出貨店",
    refId: "doc-w1",
    docNo: "W-0001",
    payable: 37_200,
    net,
    kind: due < 0 ? "to_refund" : "to_receive",
    amount: Math.abs(due),
    button: due < 0 ? "out" : "in",
  });
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [masterDataOrgs.storeA],
      modules: [overviewModule],
    }).handlers,
    api.query("LotterySettlement", () =>
      HttpResponse.json({
        data: {
          lotterySettlement: {
            item: {
              ...settlement,
              sides: settlement.sides.map((side) => ({
                ...side,
                role: "payee",
              })),
            },
          },
        },
      }),
    ),
  );
  renderApp({
    extra: <SettlementPanel moduleKey={MODULE_KEY} refId="doc-w1" />,
  });
};

/** 批售單的金額列(規格 21.6;Figma WS-03a、WS-03b-2、WS-03d):批售金額、已收、待收 / 待退。 */
describe("SettlementPanel:只有收款方一邊(批售單)", () => {
  it.each([
    ["收了一部分", 20_000, "待收", "17,200", "收款"],
    ["多收", 37_500, "待退", "300", "退款"],
    ["收齊", 37_200, "待收", "0", null],
  ])("%s", async (_name, net, label, amount, button) => {
    renderWholesale(net);
    expect(await screen.findByText("批售金額")).toBeInTheDocument();
    expect(screen.getByText("已收")).toBeInTheDocument();
    expect(screen.getByText(label).nextElementSibling).toHaveTextContent(
      amount,
    );
    if (button === null) {
      expect(
        screen.queryByRole("button", { name: /^(收款|退款)$/ }),
      ).not.toBeInTheDocument();
    } else {
      expect(
        screen.getAllByRole("button", { name: button }).length,
      ).toBeGreaterThan(0);
    }
  });
});
