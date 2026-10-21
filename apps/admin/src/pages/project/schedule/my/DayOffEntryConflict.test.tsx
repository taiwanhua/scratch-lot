import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { renderSchedulePage } from "../schedule-test-support";

/**
 * 先排班、後登記畫休(使用者定案:照樣可以登記,但要提醒):存檔後 api 回這天已有的排班,
 * 畫面提醒「這天已經有排班(…),請通知店長調整班表」。
 */
describe("登記畫休:那天已經有排班", () => {
  it("我的畫休:照樣存,存檔後提醒通知店長調整班表", async () => {
    const { user } = renderSchedulePage({
      path: "/schedule/my?tab=day-offs",
      dayOffs: { scheduledDates: ["2026-12-03"] },
    });
    await user.click(await screen.findByRole("button", { name: "登記畫休" }));
    const dialog = await screen.findByRole("dialog", { name: "登記畫休" });
    await user.type(within(dialog).getByLabelText(/日期/), "2026-12-03");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await screen.findByText(
        "這天已經有排班(12/3 14:30–22:00 A-2 台北分店),請通知店長調整班表",
      ),
    ).toBeInTheDocument();
  });

  it("代改:照樣存,存檔後提醒", async () => {
    const { user } = renderSchedulePage({
      path: "/schedule/manage?tab=day-offs&month=2026-12",
      dayOffs: { scheduledDates: ["2026-12-03"] },
    });
    await user.click(await screen.findByRole("button", { name: "代改" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
    const options = await screen.findAllByRole("option");
    const firstPerson = options.at(0);
    if (firstPerson === undefined) {
      throw new Error("沒有可以選的人");
    }
    await user.click(firstPerson);
    await user.type(within(dialog).getByLabelText(/日期/), "2026-12-03");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await screen.findByText(
        "這天已經有排班(12/3 14:30–22:00 A-2 台北分店),請通知店長調整班表",
      ),
    ).toBeInTheDocument();
  });
});
