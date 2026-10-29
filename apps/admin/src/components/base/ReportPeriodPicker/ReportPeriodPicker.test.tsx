import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";
import { useState } from "react";

import type {
  ReportPeriodKind,
  ReportPeriodValue,
} from "@/lib/base/reports/report-period";
import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { ReportPeriodPicker } from "./ReportPeriodPicker";

const TODAY = "2026-10-14";

interface HarnessProps {
  initial: ReportPeriodValue;
  kinds?: readonly ReportPeriodKind[];
}

/** 受控外殼:把目前的值印出來給斷言。 */
const Harness = ({
  initial,
  kinds = ["day", "week", "month"],
}: HarnessProps) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ReportPeriodPicker
        value={value}
        onChange={setValue}
        kinds={kinds}
        today={TODAY}
      />
      <output data-testid="value">{`${value.kind} ${value.date}`}</output>
    </>
  );
};

const renderPicker = (props: HarnessProps) => {
  server.use(...authWorld({ hasRefreshCookie: true }).handlers);
  return renderApp({ path: "/overview", extra: <Harness {...props} /> });
};

const valueText = async () => {
  const output = await screen.findByTestId("value");
  return output.textContent;
};

describe("ReportPeriodPicker", () => {
  it("日:[昨天] 換成前一天;換到週 → 整理成那一週的星期日", async () => {
    const { user } = renderPicker({ initial: { kind: "day", date: TODAY } });
    await user.click(await screen.findByRole("button", { name: "昨天" }));
    expect(await valueText()).toBe("day 2026-10-13");

    await user.click(screen.getByRole("tab", { name: "週" }));
    expect(await valueText()).toBe("week 2026-10-11");
  });

  it("週:點任一天選整週,顯示「10/11(日)~ 10/17(六)」;[上週]", async () => {
    const { user } = renderPicker({
      initial: { kind: "week", date: "2026-10-04" },
    });
    const calendar = await screen.findByRole("grid", { name: "選擇週" });
    await user.click(
      within(calendar).getByRole("gridcell", { name: "2026-10-15" }),
    );
    expect(await valueText()).toBe("week 2026-10-11");
    expect(screen.getByText("10/11(日)~ 10/17(六)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上週" }));
    expect(await valueText()).toBe("week 2026-10-04");
  });

  it("月:點月份格子選那個月;[上月]", async () => {
    const { user } = renderPicker({
      initial: { kind: "month", date: "2026-10-01" },
    });
    await user.click(await screen.findByRole("button", { name: "7 月" }));
    expect(await valueText()).toBe("month 2026-07-01");
    await user.click(screen.getByRole("button", { name: "上月" }));
    expect(await valueText()).toBe("month 2026-09-01");
  });

  it("只允許一種期間時不顯示頁籤", async () => {
    renderPicker({ initial: { kind: "day", date: TODAY }, kinds: ["day"] });
    await screen.findByRole("button", { name: "今天" });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
