import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { LotteryWholesaleCustomerStatus } from "@repo/graphql";

import { expectButtonOrder } from "@/test/button-order";
import {
  WHOLESALE_CUSTOMER_TEST_ROUTES,
  wholesaleCustomerFixtures,
} from "@/test/msw/project/wholesale-customers-fixtures";
import {
  restoreViewportAfterEach,
  setMobileViewport,
  setupFakeViewport,
} from "@/test/viewport";

import { DEALERS_TEST_ROUTES, renderDealers } from "../dealers-test-support";

setupFakeViewport();
restoreViewportAfterEach();
restoreViewportAfterEach();

const LIST = `${DEALERS_TEST_ROUTES.list}?tab=wholesale-customers`;
const VIEW_GOOD_LUCK = `${WHOLESALE_CUSTOMER_TEST_ROUTES.viewPage}/wholesale-1`;
const CREATE = WHOLESALE_CUSTOMER_TEST_ROUTES.createPage;
const EDIT_GOOD_LUCK = `${WHOLESALE_CUSTOMER_TEST_ROUTES.editPage}/wholesale-1`;
const EDIT_BIG_FORTUNE = `${WHOLESALE_CUSTOMER_TEST_ROUTES.editPage}/wholesale-2`;

/** 批售客戶分頁(規格 21.2;Figma DE-09)。 */
describe("批售客戶分頁", () => {
  it("分頁順序 甲類 | 乙類 | 關係人 | 批售客戶;欄位與「無紀錄」", async () => {
    renderDealers({ path: LIST });
    const row = await screen.findByRole("row", { name: /大發彩券行/ });
    expect(
      within(screen.getByRole("tablist", { name: "經銷商管理分頁" }))
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["甲類", "乙類", "關係人", "批售客戶"]);
    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["店名", "證號", "聯絡人", "電話", "狀態", "最近一次批售日"]);
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("往來中")).toBeInTheDocument();
    expect(within(row).getByText("無紀錄")).toBeInTheDocument();
    const stopped = screen.getByRole("row", { name: /吉利彩券行/ });
    expect(within(stopped).getByText("停用")).toBeInTheDocument();
    expect(within(stopped).getByText("2026-08-12")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ 新增批售客戶" }),
    ).toBeInTheDocument();
  });

  it("篩選狀態與關鍵字送給 api", async () => {
    const { user, wholesale } = renderDealers({ path: LIST });
    await screen.findByRole("row", { name: /好運彩券行/ });
    await user.type(
      screen.getByRole("textbox", { name: "關鍵字(店名、證號、聯絡人、電話)" }),
      "大發",
    );
    await waitFor(() => {
      expect(wholesale.listInputs.at(-1)).toMatchObject({
        keyword: "大發",
        page: 1,
      });
    });
    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "往來中" }));
    await waitFor(() => {
      expect(wholesale.listInputs.at(-1)?.status).toBe(
        LotteryWholesaleCustomerStatus.Active,
      );
    });
  });

  it("沒綁 dealers.wholesale-customers:沒有這個分頁;沒有 create:看不到新增按鈕", async () => {
    renderDealers({ withWholesaleCustomers: false });
    await screen.findByRole("row", { name: /陳志明/ });
    expect(
      screen.queryByRole("tab", { name: "批售客戶" }),
    ).not.toBeInTheDocument();
  });

  it("店長(只綁分頁):看得到清單,沒有新增按鈕", async () => {
    renderDealers({ path: LIST, wholesalePermissions: [] });
    await screen.findByRole("row", { name: /好運彩券行/ });
    expect(
      screen.queryByRole("button", { name: /\+ 新增/ }),
    ).not.toBeInTheDocument();
  });

  it("手機寬:每位客戶一張卡片,狀態收進 [篩選] 抽屜", async () => {
    setMobileViewport();
    renderDealers({ path: LIST });
    const list = await screen.findByRole("list", { name: "批售客戶清單" });
    const card = within(list).getAllByRole("listitem")[0];
    expect(within(card).getByText("好運彩券行")).toBeInTheDocument();
    expect(within(card).getByText("最近一次批售日")).toBeInTheDocument();
    expect(within(card).getByText("2026-11-19")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "篩選" })).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "狀態" }),
    ).not.toBeInTheDocument();
  });
});

/** 批售客戶詳情頁(Figma DE-10a)。 */
describe("批售客戶詳情頁", () => {
  it("標頭摘要、三個區塊(系統資訊收合);按鈕順序 [← 返回列表] [編輯]", async () => {
    const { user } = renderDealers({ path: VIEW_GOOD_LUCK });
    expect(
      await screen.findByRole("heading", {
        name: "好運彩券行 · 證號 12345678",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("聯絡人 林大明 · 0223456789 · 最近一次批售 2026-11-19"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("新北市三重區重新路 3 段 88 號"),
    ).toBeInTheDocument();
    expect(screen.getByText("每月中旬來拿貨,習慣匯款")).toBeInTheDocument();
    expect(screen.getByText("總公司 · 2026-09-01 建立")).toBeInTheDocument();
    expect(expectButtonOrder(["← 返回列表", "編輯"])[1]).toHaveClass(
      "MuiButton-contained",
    );
    await user.click(screen.getByRole("button", { name: /系統資訊/ }));
    expect(await screen.findByText("所屬組織")).toBeInTheDocument();
  });

  it("canEdit = false(沒有 edit 或共用進來的):看不到 [編輯]", async () => {
    renderDealers({
      path: VIEW_GOOD_LUCK,
      wholesalePermissions: [],
      wholesaleCustomers: wholesaleCustomerFixtures.map((customer) => ({
        ...customer,
        abilities: { ...customer.abilities, canEdit: false },
      })),
    });
    await screen.findByRole("heading", { name: /好運彩券行/ });
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
  });
});

/** 批售客戶新增 / 編輯頁(Figma DE-11a / DE-11b)。 */
describe("批售客戶新增 / 編輯頁", () => {
  it("店名同名:欄位下方提醒、照樣能存", async () => {
    const { user, wholesale } = renderDealers({ path: CREATE });
    const storeName = await screen.findByRole("textbox", { name: /店名/ });
    await user.type(storeName, "好運彩券行");
    await waitFor(() => {
      expect(storeName).toHaveAccessibleDescription(
        "已有同名的批售客戶:好運彩券行(0223456789)",
      );
    });
    expect(storeName).not.toBeInvalid();
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(wholesale.inputs.create).toEqual([
        {
          storeName: "好運彩券行",
          licenseNo: null,
          contactName: null,
          phone: null,
          address: null,
          status: "ACTIVE",
          note: null,
          shareOrgs: [],
        },
      ]);
    });
    expect(
      await screen.findByRole("heading", { name: "好運彩券行" }),
    ).toBeInTheDocument();
  });

  it("證號重複:原因寫在證號欄下方", async () => {
    const { user } = renderDealers({ path: CREATE });
    await user.type(
      await screen.findByRole("textbox", { name: /店名/ }),
      "新客戶",
    );
    const licenseNo = screen.getByRole("textbox", { name: "證號" });
    await user.type(licenseNo, "12345678");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(licenseNo).toHaveAccessibleDescription(
        "這個證號已經有批售客戶使用",
      );
    });
  });

  it("沒填店名:欄位下方寫格式要求", async () => {
    const { user } = renderDealers({ path: CREATE });
    const storeName = await screen.findByRole("textbox", { name: /店名/ });
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(storeName).toHaveAccessibleDescription("必填,最多 30 個字");
    });
  });

  it("編輯:自己不算同名、只送動過的欄位;動作列 [刪除] … [取消] [儲存]", async () => {
    const { user, wholesale } = renderDealers({ path: EDIT_GOOD_LUCK });
    const storeName = await screen.findByRole("textbox", { name: /店名/ });
    expectButtonOrder(["刪除", "取消", "儲存"]);
    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "停用" }));
    expect(storeName).not.toHaveAccessibleDescription();
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(wholesale.inputs.update).toEqual([
        { id: "wholesale-1", status: "INACTIVE" },
      ]);
    });
  });

  it("刪除被批售單引用的客戶:擋下並提示改成停用,留在編輯頁", async () => {
    const { user, wholesale } = renderDealers({ path: EDIT_GOOD_LUCK });
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除批售客戶" });
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));
    expect(
      await screen.findByText(
        "好運彩券行已有批售單,不能刪除;不再往來請把狀態改成停用",
      ),
    ).toBeInTheDocument();
    expect(wholesale.inputs.delete).toEqual([{ id: "wholesale-1" }]);
    expect(screen.getByRole("textbox", { name: /店名/ })).toBeInTheDocument();
  });

  it("刪除沒被引用的客戶:刪掉後回列表", async () => {
    const { user } = renderDealers({ path: EDIT_BIG_FORTUNE });
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除批售客戶" });
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));
    expect(await screen.findByText("已刪除批售客戶")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "經銷商管理" }),
    ).toBeInTheDocument();
  });

  it("共用給:沒有 edit 的人(只有 create)新增頁看不到", async () => {
    renderDealers({
      path: CREATE,
      wholesalePermissions: ["dealers.wholesale-customers.create"],
    });
    await screen.findByRole("textbox", { name: /店名/ });
    expect(screen.queryByLabelText("共用給")).not.toBeInTheDocument();
  });
});
