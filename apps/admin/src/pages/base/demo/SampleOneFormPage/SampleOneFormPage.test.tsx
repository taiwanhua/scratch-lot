import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { SAMPLE_ONE_PERMISSIONS } from "../demo-sample-one-config";
import {
  SAMPLE_ONE_ROUTES,
  VIEW_ONLY,
  renderSampleOne,
} from "../demo-sample-one-test-support";

const editPath = (id: string) => `${SAMPLE_ONE_ROUTES.editPage}/${id}`;

/** 沒有「內部備註可改」,但看得到(`show-internal-note` 仍在)。 */
const READONLY_INTERNAL_NOTE = [
  ...VIEW_ONLY,
  SAMPLE_ONE_PERMISSIONS.create,
  SAMPLE_ONE_PERMISSIONS.showInternalNote,
];

/**
 * 新增 / 編輯共版型(Figma 175:558)。
 * 兩個隱藏頁模組共用同一個元件,情境由 `module.key` 決定。
 */
describe("新增 / 編輯示範項目(共版型)", () => {
  beforeAll(() => {
    // jsdom 陷阱(TEST-08):`jest-fixed-jsdom` 補回的是 Node 的 `URL`,
    // `createObjectURL` 只收 Node 的 `Blob`,拿 `File` 會炸 —— 測到上傳預覽的頁面要 stub
    URL.createObjectURL = jest.fn(() => "blob:preview");
    URL.revokeObjectURL = jest.fn();
  });

  it("新增頁:空白表單 + 填寫提示區塊(持有 create-page.show-tips)", async () => {
    renderSampleOne({ path: SAMPLE_ONE_ROUTES.createPage });

    expect(
      await screen.findByRole("heading", { name: "新增示範項目" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("名稱 *")).toHaveValue("");
    expect(
      screen.getByRole("region", { name: "填寫提示" }),
    ).toBeInTheDocument();
    // 變更歷程只在編輯頁
    expect(
      screen.queryByRole("region", { name: "變更歷程" }),
    ).not.toBeInTheDocument();
  });

  it("新增頁沒有 show-tips 權限:提示區塊不顯示(新增照樣做得了)", async () => {
    renderSampleOne({
      path: SAMPLE_ONE_ROUTES.createPage,
      permissions: [...VIEW_ONLY, SAMPLE_ONE_PERMISSIONS.create],
    });

    await screen.findByRole("heading", { name: "新增示範項目" });
    expect(
      screen.queryByRole("region", { name: "填寫提示" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "儲存" })).toBeInTheDocument();
  });

  it("新增:送出的 input 帶名稱、分類、狀態與內部備註", async () => {
    const { user: actor, fake } = renderSampleOne({
      path: SAMPLE_ONE_ROUTES.createPage,
    });
    await screen.findByRole("heading", { name: "新增示範項目" });

    await actor.type(screen.getByLabelText("名稱 *"), "蔥爆牛肉");
    await actor.click(screen.getByLabelText("分類"));
    await actor.click(await screen.findByRole("option", { name: /主食/ }));
    await actor.type(screen.getByLabelText("內部備註"), "成本待確認");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.createDemoItemOne).toHaveLength(1);
    });
    expect(fake.inputs.createDemoItemOne[0]).toMatchObject({
      name: "蔥爆牛肉",
      category: "staple",
      status: "DRAFT",
      internalNote: "成本待確認",
    });
    // 儲存成功後回列表
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_ONE_ROUTES.list,
    );
  });

  it("沒有 show-internal-note:內部備註整欄不顯示,input 裡也不會出現這個鍵", async () => {
    const { user: actor, fake } = renderSampleOne({
      path: SAMPLE_ONE_ROUTES.createPage,
      permissions: [...VIEW_ONLY, SAMPLE_ONE_PERMISSIONS.create],
    });
    await screen.findByRole("heading", { name: "新增示範項目" });

    expect(screen.queryByLabelText("內部備註")).not.toBeInTheDocument();

    await actor.type(screen.getByLabelText("名稱 *"), "蔥爆牛肉");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.createDemoItemOne).toHaveLength(1);
    });
    // 「一出現就要權限」:連 null 都不能送,所以整個鍵不存在
    expect(fake.inputs.createDemoItemOne[0]).not.toHaveProperty("internalNote");
  });

  it("有檢視、無編輯內部備註:欄位是唯讀的,送出時也不帶這個鍵", async () => {
    const { user: actor, fake } = renderSampleOne({
      path: SAMPLE_ONE_ROUTES.createPage,
      permissions: READONLY_INTERNAL_NOTE,
      world: {
        items: [],
        canShowInternalNote: true,
      },
    });
    await screen.findByRole("heading", { name: "新增示範項目" });

    expect(screen.getByLabelText("內部備註")).toBeDisabled();

    await actor.type(screen.getByLabelText("名稱 *"), "蔥爆牛肉");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.createDemoItemOne).toHaveLength(1);
    });
    expect(fake.inputs.createDemoItemOne[0]).not.toHaveProperty("internalNote");
  });

  it("編輯頁:表單帶入既有值 + 變更歷程區塊(持有 edit-page.show-history)", async () => {
    renderSampleOne({ path: editPath("demo-1") });

    expect(
      await screen.findByRole("heading", {
        name: "編輯示範項目 — 醬燒雞腿排",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("名稱 *")).toHaveValue("醬燒雞腿排");
    expect(screen.getByLabelText("備註")).toHaveValue("週末限定測試資料");

    const history = await screen.findByRole("region", { name: "變更歷程" });
    expect(within(history).getByText(/王小明 建立/)).toBeInTheDocument();
    expect(within(history).getByText(/王小明 修改了內容/)).toBeInTheDocument();
    // 填寫提示只在新增頁
    expect(
      screen.queryByRole("region", { name: "填寫提示" }),
    ).not.toBeInTheDocument();
  });

  it("變更歷程的時間用讀者的租戶時區(不是預設的台北、也不是執行環境的時區)", async () => {
    renderSampleOne({
      path: editPath("demo-1"),
      timezone: "America/New_York",
    });

    const history = await screen.findByRole("region", { name: "變更歷程" });
    // 夾具是 UTC:09-10 06:22Z → 紐約(夏令 UTC−4)09-10 02:22;09-01 01:05Z → 08-31 21:05
    expect(
      await within(history).findByText("2026-09-10 02:22 王小明 修改了內容"),
    ).toBeInTheDocument();
    expect(
      within(history).getByText("2026-08-31 21:05 王小明 建立"),
    ).toBeInTheDocument();
  });

  it("編輯頁沒有 show-history 權限:歷程區塊不顯示,也不打那個查詢", async () => {
    const { fake } = renderSampleOne({
      path: editPath("demo-1"),
      permissions: [
        ...VIEW_ONLY,
        SAMPLE_ONE_PERMISSIONS.showInternalNote,
        SAMPLE_ONE_PERMISSIONS.editInternalNote,
      ],
    });

    await screen.findByLabelText("名稱 *");
    expect(
      screen.queryByRole("region", { name: "變更歷程" }),
    ).not.toBeInTheDocument();
    expect(fake.calls.history).toBe(0);
  });

  it("編輯:沒動的封面與附件不放進 input(缺席 = 不動,GQL-06;不再原樣送回)", async () => {
    const { user: actor, fake } = renderSampleOne({ path: editPath("demo-1") });
    await screen.findByLabelText("名稱 *");

    await actor.clear(screen.getByLabelText("名稱 *"));
    await actor.type(screen.getByLabelText("名稱 *"), "醬燒雞腿排(改)");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateDemoItemOne).toHaveLength(1);
    });
    const [input] = fake.inputs.updateDemoItemOne;
    expect(input).toMatchObject({ id: "demo-1", name: "醬燒雞腿排(改)" });
    expect(input).not.toHaveProperty("coverPath");
    expect(input).not.toHaveProperty("attachment");
  });

  it("編輯頁顯示目前附件的原始檔名", async () => {
    renderSampleOne({ path: editPath("demo-1") });

    expect(
      await screen.findByText("目前的附件:成本試算 2026.png"),
    ).toBeInTheDocument();
  });

  it("移除附件:送 null 給 api(清空)", async () => {
    const { user: actor, fake } = renderSampleOne({ path: editPath("demo-1") });
    await screen.findByLabelText("名稱 *");

    await actor.click(screen.getByRole("button", { name: "移除附件" }));
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateDemoItemOne).toHaveLength(1);
    });
    expect(fake.inputs.updateDemoItemOne[0].attachment).toBeNull();
  });

  it("取消:改過就先問一次放棄變更,確認後才離開", async () => {
    const { user: actor } = renderSampleOne({ path: editPath("demo-1") });
    await screen.findByLabelText("名稱 *");

    await actor.type(screen.getByLabelText("備註"), "再加一句");
    await actor.click(screen.getByRole("button", { name: "取消" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "放棄未儲存的變更?" }),
    ).toBeInTheDocument();

    // 「繼續編輯」留在原地
    await actor.click(within(dialog).getByRole("button", { name: "繼續編輯" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("名稱 *")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "取消" }));
    await actor.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "放棄變更",
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_ONE_ROUTES.list,
    );
  });

  it("沒改過就按取消:直接回列表,不問", async () => {
    const { user: actor } = renderSampleOne({ path: editPath("demo-1") });
    await screen.findByLabelText("名稱 *");

    await actor.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_ONE_ROUTES.list,
    );
  });

  it("VALIDATION_FAILED fields:[category] 標在分類欄上,不是一條看不懂的橫幅", async () => {
    const { user: actor } = renderSampleOne({
      path: editPath("demo-1"),
      world: {
        failures: {
          UpdateDemoItemOne: {
            code: "VALIDATION_FAILED",
            extensions: { fields: ["category"] },
          },
        },
      },
    });
    await screen.findByLabelText("名稱 *");

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(screen.getByLabelText("分類")).toHaveAccessibleDescription(
        "這個分類不在你可用的選項內,或已被停用。",
      );
    });
  });

  it("FIELD_FORBIDDEN:硬送內部備註被 api 擋下時講明是哪一件事", async () => {
    const { user: actor } = renderSampleOne({
      path: editPath("demo-1"),
      world: {
        failures: {
          UpdateDemoItemOne: {
            code: "FORBIDDEN",
            extensions: { reason: "FIELD_FORBIDDEN" },
          },
        },
      },
    });
    await screen.findByLabelText("名稱 *");

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    // 橫幅講的是「這次變更沒有存檔」;欄位上的那句只說明欄位本身,兩條文案不同
    expect(await screen.findByText(/這次變更沒有存檔/)).toBeInTheDocument();
  });

  it("上傳封面:走 createUploadUrl → PUT → 把 objectPath 交給 update(ADR-0010 三步)", async () => {
    const { user: actor, fake } = renderSampleOne({ path: editPath("demo-1") });
    await screen.findByLabelText("名稱 *");

    const file = new File(["cover-bytes"], "cover.png", { type: "image/png" });
    await actor.upload(screen.getByLabelText("封面"), file);
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateDemoItemOne).toHaveLength(1);
    });
    expect(fake.inputs.createUploadUrl[0]).toMatchObject({
      purpose: "DEMO_COVER",
      contentType: "image/png",
    });
    expect(fake.uploadedFiles).toHaveLength(1);
    expect(fake.inputs.updateDemoItemOne[0].coverPath).toBe("demo/1.png");
  });

  it("上傳附件:原始檔名 / 大小 / 檔型與 objectPath 一起送", async () => {
    const { user: actor, fake } = renderSampleOne({ path: editPath("demo-1") });
    await screen.findByLabelText("名稱 *");

    const file = new File(["%PDF-1.4 demo"], "新版合約.pdf", {
      type: "application/pdf",
    });
    await actor.upload(screen.getByLabelText("附件"), file);
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateDemoItemOne).toHaveLength(1);
    });
    expect(fake.inputs.createUploadUrl[0]).toMatchObject({
      purpose: "DEMO_ATTACHMENT",
      contentType: "application/pdf",
      size: file.size,
    });
    expect(fake.inputs.updateDemoItemOne[0].attachment).toEqual({
      path: "demo/1.png", // 假伺服器的 objectPath 一律 .png
      name: "新版合約.pdf",
      size: file.size,
      contentType: "application/pdf",
    });
    // 封面沒動 → 不放進 input
    expect(fake.inputs.updateDemoItemOne[0]).not.toHaveProperty("coverPath");
  });
});
