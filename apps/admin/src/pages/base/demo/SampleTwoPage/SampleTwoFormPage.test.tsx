import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";

import { checkboxOf } from "@/components/base/OrgTreeSelect/org-tree-select-test-support";
import { api, server } from "@/test/msw/server";

import {
  SAMPLE_TWO_ROUTES,
  findSampleTwoRowOf,
  renderSampleTwo,
} from "../demo-sample-two-test-support";

const editPath = (id: string) => `${SAMPLE_TWO_ROUTES.editPage}/${id}`;

/**
 * 示範模組2 的新增 / 編輯共版型。兩個隱藏頁模組共用同一個元件,
 * 情境由 `module.key` 決定 —— 與示範模組1 是同一份共用元件,只是設定物件不同。
 */
describe("示範模組2 的新增 / 編輯(共版型)", () => {
  it("新增頁:只有名稱與備註,沒有提示區塊與上傳欄(對照組沒有那些)", async () => {
    renderSampleTwo({ path: SAMPLE_TWO_ROUTES.createPage });

    expect(
      await screen.findByRole("heading", { name: "新增示範項目" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("名稱 *")).toHaveValue("");
    expect(screen.getByLabelText("備註")).toHaveValue("");

    expect(screen.queryByLabelText("內部備註")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("分類")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("狀態")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("封面")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "填寫提示" }),
    ).not.toBeInTheDocument();
  });

  it("共用給:有編輯權限才出現;勾「含下層」一起送出(資料共用)", async () => {
    const { user: actor, fake } = renderSampleTwo({
      path: SAMPLE_TWO_ROUTES.createPage,
    });
    await screen.findByRole("heading", { name: "新增示範項目" });
    await actor.type(screen.getByLabelText("名稱 *"), "共用的項目");
    await actor.click(screen.getByRole("combobox", { name: "共用給" }));
    await screen.findByText("中山店");
    // 多選:勾節點左側的勾選框(面板不關),再按 Escape 關掉面板
    fireEvent.click(checkboxOf("中山店"));
    await actor.keyboard("{Escape}");
    await actor.click(await screen.findByLabelText("中山店含下層"));
    await actor.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.createDemoItemTwo).toEqual([
        {
          name: "共用的項目",
          note: null,
          shareOrgs: [{ orgId: "org-store-a", includeDescendants: true }],
        },
      ]);
    });
  });

  it("新增:送出的 input 只有名稱與備註,沒填的備註送 null", async () => {
    const { user: actor, fake } = renderSampleTwo({
      path: SAMPLE_TWO_ROUTES.createPage,
    });
    await screen.findByRole("heading", { name: "新增示範項目" });

    await actor.type(screen.getByLabelText("名稱 *"), "對照組新項目");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.createDemoItemTwo).toEqual([
        // 「共用給」沒選 = 空清單(不共用)
        { name: "對照組新項目", note: null, shareOrgs: [] },
      ]);
    });
    // 儲存成功後回列表
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_TWO_ROUTES.list,
    );
  });

  it("編輯頁:帶入既有值,沒有變更歷程區塊(對照組沒有歷程)", async () => {
    renderSampleTwo({ path: editPath("demo-two-1") });

    expect(
      await screen.findByRole("heading", {
        name: "編輯示範項目 — 對照組項目A",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("名稱 *")).toHaveValue("對照組項目A");
    expect(screen.getByLabelText("備註")).toHaveValue(
      "沒有分類、沒有狀態的對照資料",
    );
    expect(
      screen.queryByRole("region", { name: "變更歷程" }),
    ).not.toBeInTheDocument();
  });

  it("編輯:送出帶 id 與兩個欄位", async () => {
    const { user: actor, fake } = renderSampleTwo({
      path: editPath("demo-two-1"),
    });
    await screen.findByLabelText("名稱 *");

    await actor.clear(screen.getByLabelText("名稱 *"));
    await actor.type(screen.getByLabelText("名稱 *"), "對照組項目A(改)");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateDemoItemTwo).toHaveLength(1);
    });
    expect(fake.inputs.updateDemoItemTwo[0]).toEqual({
      id: "demo-two-1",
      name: "對照組項目A(改)",
      note: "沒有分類、沒有狀態的對照資料",
      shareOrgs: [],
    });
  });

  // 儲存後回列表、馬上再進編輯頁,看到的是舊值(過一陣才對)。
  // 這裡把儲存後的單筆重取**擋住不回**,畫面就只剩快取可用 ——
  // `useSave` 沒把回傳的 payload 寫進單筆的 key 的話,看到的會是儲存前那一份。
  it("儲存後馬上再進編輯頁看到新值(單筆重取還沒回來也一樣)", async () => {
    const { user: actor, fake } = renderSampleTwo({
      path: editPath("demo-two-1"),
    });
    await screen.findByLabelText("名稱 *");

    await actor.clear(screen.getByLabelText("名稱 *"));
    await actor.type(screen.getByLabelText("名稱 *"), "對照組項目A(改)");
    server.use(
      api.query("DemoItemTwo", async () => {
        await delay("infinite");
      }),
    );
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateDemoItemTwo).toHaveLength(1);
    });
    // 儲存成功後回列表,清單重取得到新名稱
    const row = await findSampleTwoRowOf("對照組項目A");

    await actor.click(within(row).getByRole("button", { name: /^編輯/ }));

    expect(await screen.findByLabelText("名稱 *")).toHaveValue(
      "對照組項目A(改)",
    );
  });

  it("取消:改過就先問一次放棄變更,確認後才離開", async () => {
    const { user: actor } = renderSampleTwo({ path: editPath("demo-two-1") });
    await screen.findByLabelText("名稱 *");

    await actor.type(screen.getByLabelText("備註"), "再加一句");
    await actor.click(screen.getByRole("button", { name: "取消" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "放棄未儲存的變更？" }),
    ).toBeInTheDocument();

    await actor.click(within(dialog).getByRole("button", { name: "放棄變更" }));
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_TWO_ROUTES.list,
    );
  });

  it("沒改過就按取消:直接回列表,不問", async () => {
    const { user: actor } = renderSampleTwo({ path: editPath("demo-two-1") });
    await screen.findByLabelText("名稱 *");

    await actor.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_TWO_ROUTES.list,
    );
  });

  it("VALIDATION_FAILED fields:[name] 標在名稱欄上,不是一條看不懂的橫幅", async () => {
    const { user: actor } = renderSampleTwo({
      path: editPath("demo-two-1"),
      world: {
        failures: {
          UpdateDemoItemTwo: {
            code: "VALIDATION_FAILED",
            extensions: { fields: ["name"] },
          },
        },
      },
    });
    await screen.findByLabelText("名稱 *");

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(screen.getByLabelText("名稱 *")).toHaveAccessibleDescription(
        "請填寫名稱。",
      );
    });
  });
});
