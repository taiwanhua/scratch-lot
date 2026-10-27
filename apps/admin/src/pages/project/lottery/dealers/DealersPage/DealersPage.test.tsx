import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { LotteryLicenseState } from "@repo/graphql";

import { dealerFixtures } from "@/test/msw/project/dealers-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import { renderDealers } from "../dealers-test-support";

setupFakeViewport();

/** 經銷商管理列表(`/dealers`;Figma DE-01 / DE-02 / DE-07)。 */
describe("經銷商管理列表(/dealers)", () => {
  it("甲類分頁:證號、姓名、共同銷售處所、距批購 N 天(超過 180 天錯誤色)、本季見簽、狀態", async () => {
    renderDealers();

    const row = await screen.findByRole("row", { name: /陳志明/ });
    expect(within(row).getByText("12345678")).toBeInTheDocument();
    expect(within(row).getByText("好運 2 號店")).toBeInTheDocument();
    expect(within(row).getByText("12 天")).toBeInTheDocument();
    expect(within(row).getByText("152 天")).toBeInTheDocument();
    expect(within(row).getByText("已見簽")).toBeInTheDocument();

    const overdue = screen.getByRole("row", { name: /林大同/ });
    expect(within(overdue).getByText("183 天")).toBeInTheDocument();
    expect(within(overdue).getByText("無紀錄")).toBeInTheDocument();
    expect(within(overdue).getByText("未見簽")).toBeInTheDocument();
  });

  it("快速篩選「逾 180 天」把條件送給 api", async () => {
    const { user, fake } = renderDealers();
    await screen.findByRole("row", { name: /陳志明/ });

    await user.click(screen.getByRole("button", { name: "逾 180 天" }));

    await waitFor(() => {
      expect(fake.listInputs.at(-1)).toMatchObject({
        type: "A",
        purchaseOverDays: 180,
      });
    });
  });

  it("乙類分頁:對應分店未選警告、共同銷售人超過 6 紅字", async () => {
    const { user } = renderDealers();
    await screen.findByRole("row", { name: /陳志明/ });

    await user.click(screen.getByRole("tab", { name: "乙類" }));

    const row = await screen.findByRole("row", { name: /好運 3 號店/ });
    expect(within(row).getByText("未選分店")).toBeInTheDocument();
    expect(within(row).getByText("7 / 6")).toBeInTheDocument();
  });

  it("甲類、乙類都有「證照到期」欄(到期日;30 天內到期 / 已過期的標警告 / 錯誤色,規格 5.2)", async () => {
    const { user } = renderDealers({
      world: {
        dealers: dealerFixtures.map((dealer) =>
          dealer.id === "dealer-a-2"
            ? {
                ...dealer,
                licenseExpiresAt: "2026-11-15T00:00:00.000Z",
                licenseState: LotteryLicenseState.Expiring,
              }
            : dealer,
        ),
      },
    });

    const headers = () =>
      screen.getAllByRole("columnheader").map((header) => header.textContent);
    const expiring = await screen.findByRole("row", { name: /林大同/ });
    expect(headers()).toContain("證照到期");
    expect(within(expiring).getByText("2026-11-15")).toBeInTheDocument();
    const ok = screen.getByRole("row", { name: /陳志明/ });
    expect(within(ok).getByText("2027-02-28")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "乙類" }));
    const classB = await screen.findByRole("row", { name: /好運 3 號店/ });
    expect(headers()).toContain("證照到期");
    expect(within(classB).getByText("2027-02-28")).toBeInTheDocument();
  });

  it("證照快速篩選:甲類「證照 30 天內到期」、乙類「證照已過期」把條件送給 api;再點一次取消", async () => {
    const { user, fake } = renderDealers();
    await screen.findByRole("row", { name: /陳志明/ });

    await user.click(screen.getByRole("button", { name: "證照 30 天內到期" }));
    await waitFor(() => {
      expect(fake.listInputs.at(-1)).toMatchObject({
        type: "A",
        licenseState: LotteryLicenseState.Expiring,
      });
    });

    await user.click(screen.getByRole("tab", { name: "乙類" }));
    await screen.findByRole("row", { name: /好運 3 號店/ });
    const expired = screen.getByRole("button", { name: "證照已過期" });
    expect(expired).toHaveAttribute("aria-pressed", "false");
    await user.click(expired);
    await waitFor(() => {
      expect(fake.listInputs.at(-1)).toMatchObject({
        type: "B",
        licenseState: LotteryLicenseState.Expired,
      });
    });
    expect(screen.getByRole("button", { name: "證照已過期" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "證照已過期" }));
    await waitFor(() => {
      expect(fake.listInputs.at(-1)?.licenseState).toBeUndefined();
    });
  });

  it("甲類、乙類的關鍵字(證號、姓名、店名、身分證字號)送給 api,換字回第 1 頁", async () => {
    const { user, fake } = renderDealers();
    await screen.findByRole("row", { name: /陳志明/ });

    await user.type(
      screen.getByRole("textbox", { name: "關鍵字(證號、姓名、身分證)" }),
      "A2234",
    );
    await waitFor(() => {
      expect(fake.listInputs.at(-1)).toMatchObject({
        type: "A",
        keyword: "A2234",
        page: 1,
      });
    });
    // 身分證字號 A223456789 = 林大同
    await waitFor(() => {
      expect(
        screen.queryByRole("row", { name: /陳志明/ }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("row", { name: /林大同/ })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "乙類" }));
    const keyword = await screen.findByRole("textbox", {
      name: "關鍵字(證號、店名、姓名、身分證)",
    });
    expect(keyword).toHaveValue("");
    await user.type(keyword, "好運");
    await waitFor(() => {
      expect(fake.listInputs.at(-1)).toMatchObject({
        type: "B",
        keyword: "好運",
      });
    });
  });

  it("有 dealers.create:顯示 [+ 新增經銷商];沒有就不顯示(規格 5.2)", async () => {
    renderDealers();
    expect(
      await screen.findByRole("button", { name: "+ 新增經銷商" }),
    ).toBeInTheDocument();
  });

  it("沒有 dealers.create:看不到 [+ 新增經銷商]", async () => {
    renderDealers({ permissions: [] });
    await screen.findByRole("row", { name: /陳志明/ });
    expect(
      screen.queryByRole("button", { name: "+ 新增經銷商" }),
    ).not.toBeInTheDocument();
  });

  it("關係人分頁:有 dealers.contacts.create 才有 [+ 新增關係人](規格 5.3)", async () => {
    const { user } = renderDealers({ contactPermissions: [] });
    await screen.findByRole("row", { name: /陳志明/ });

    await user.click(screen.getByRole("tab", { name: "關係人" }));

    const row = await screen.findByRole("row", { name: /陳小芳/ });
    expect(within(row).getByText("受託人")).toBeInTheDocument();
    expect(within(row).getByText("代理人")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ 新增關係人" }),
    ).not.toBeInTheDocument();
  });

  it("沒綁 dealers.contacts:沒有關係人分頁", async () => {
    renderDealers({ withContacts: false });
    await screen.findByRole("row", { name: /陳志明/ });
    expect(
      screen.queryByRole("tab", { name: "關係人" }),
    ).not.toBeInTheDocument();
  });
});
