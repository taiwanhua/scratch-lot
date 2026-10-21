import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

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
