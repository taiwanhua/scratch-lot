import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { setupFakeViewport } from "@/test/viewport";

import { DEALERS_TEST_ROUTES, renderDealers } from "./dealers-test-support";

setupFakeViewport();

/** GQL-04 的 `VALIDATION_FAILED`(HTTP 200 + `errors[].extensions`)。 */
const businessError = (extensions: Record<string, unknown>) =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", extensions);

const GENERIC = "資料未通過驗證,請檢查標示的欄位";

/**
 * REACT-18:欄位錯了,原因寫在欄位正下方(格式錯 = 該欄的格式要求;api 帶了 reason = 原因);
 * 頁面底部只留通用句。
 */
describe("經銷商管理:欄位下寫原因", () => {
  it("新增甲類:證號重複 → 證號欄下寫「這個證號已經有經銷商使用」,底部只留通用句", async () => {
    const { user } = renderDealers({ path: DEALERS_TEST_ROUTES.createPage });
    server.use(
      api.mutation("CreateLotteryDealer", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["licenseNo"],
          reason: "LICENSE_NO_DUPLICATE",
        }),
      ),
    );
    const licenseNo = await screen.findByRole("textbox", { name: /證號/ });
    await user.type(licenseNo, "90000011");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(
      await screen.findByText("這個證號已經有經銷商使用"),
    ).toBeInTheDocument();
    expect(licenseNo).toHaveAccessibleDescription("這個證號已經有經銷商使用");
    expect(licenseNo).toBeInvalid();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toContain(GENERIC);
    expect(alerts.map((alert) => alert.textContent)).not.toContain(
      "這個證號已經有經銷商使用",
    );

    // 改了證號 → 那一欄的原因清掉
    await user.type(licenseNo, "2");
    expect(licenseNo).not.toHaveAccessibleDescription(
      "這個證號已經有經銷商使用",
    );
  });

  it("新增甲類:證號 7 碼、身分證字號不對(api 只回欄位)→ 各自寫格式要求", async () => {
    const { user } = renderDealers({ path: DEALERS_TEST_ROUTES.createPage });
    server.use(
      api.mutation("CreateLotteryDealer", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["licenseNo", "nationalId", "licenseApprovedAt"],
        }),
      ),
    );
    const licenseNo = await screen.findByRole("textbox", { name: /證號/ });
    await user.type(licenseNo, "9000001");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(await screen.findByText("證號要 8 碼數字")).toBeInTheDocument();
    expect(licenseNo).toHaveAccessibleDescription("證號要 8 碼數字");
    expect(
      screen.getByRole("textbox", { name: /身分證字號/ }),
    ).toHaveAccessibleDescription("身分證字號要 1 個英文字母加 9 碼數字");
    expect(screen.getByText("必填,請選擇日期")).toBeInTheDocument();
  });

  it("新增乙類:分店已被對應(api 帶 reason)→ 對應分店欄下寫原因", async () => {
    const { user } = renderDealers({ path: DEALERS_TEST_ROUTES.createPage });
    server.use(
      api.mutation("CreateLotteryDealer", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["storeOrgId"],
          reason: "STORE_OCCUPIED",
        }),
      ),
    );
    const typeGroup = await screen.findByRole("radiogroup", {
      name: "類型(建立後不能改)",
    });
    await user.click(within(typeGroup).getByRole("radio", { name: "乙類" }));
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(
      await screen.findByText("這家分店已對應其他乙類"),
    ).toBeInTheDocument();
  });

  it("新增關係人:身分證字號重複 → 欄位下寫原因;沒選身分 → 身分下寫「至少要選一個身分」", async () => {
    const { user } = renderDealers({
      path: DEALERS_TEST_ROUTES.contactCreatePage,
    });
    server.use(
      api.mutation("CreateLotteryDealerContact", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["nationalId"],
          reason: "NATIONAL_ID_DUPLICATE",
        }),
      ),
    );
    const nationalId = await screen.findByRole("textbox", {
      name: /身分證字號/,
    });
    await user.click(screen.getByRole("button", { name: "儲存" }));
    expect(nationalId).toHaveAccessibleDescription("這個身分證字號已經登記過");

    server.use(
      api.mutation("CreateLotteryDealerContact", () =>
        businessError({ code: "VALIDATION_FAILED", fields: ["roles", "name"] }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "儲存" }));
    expect(await screen.findByText("至少要選一個身分")).toBeInTheDocument();
    // 群組欄位:原因以 aria-describedby 連到「身分」那一組(報讀軟體讀得到)
    expect(
      screen.getByRole("group", { name: "身分(至少一個)" }),
    ).toHaveAccessibleDescription("至少要選一個身分");
    expect(
      screen.getByRole("textbox", { name: /姓名/ }),
    ).toHaveAccessibleDescription("必填,最多 10 個字");
  });

  it("登記見簽:沒選見簽日 → 見簽日下寫「必填,請選擇日期」", async () => {
    const { user } = renderDealers({
      path: `${DEALERS_TEST_ROUTES.viewPage}/dealer-a-1`,
    });
    await screen.findByRole("heading", { name: /陳志明/ });
    await user.click(await screen.findByRole("button", { name: "登記見簽" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "登記" }));
    expect(
      await within(dialog).findByText("必填,請選擇日期"),
    ).toBeInTheDocument();
  });
});
