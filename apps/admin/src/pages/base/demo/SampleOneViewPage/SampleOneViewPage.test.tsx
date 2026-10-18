import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { TEST_DEMO_COVER_URL, demoItems } from "@/test/msw/demo-fixtures";
import { TEST_DEMO_DOWNLOAD_URL } from "@/test/msw/demo-sample-one-handlers";

import { SAMPLE_ONE_PERMISSIONS } from "../demo-sample-one-config";
import {
  SAMPLE_ONE_ROUTES,
  VIEW_ONLY,
  renderSampleOne,
} from "../demo-sample-one-test-support";

const viewPath = (id: string) => `${SAMPLE_ONE_ROUTES.viewPage}/${id}`;

/** 示範項目詳情(Figma 175:318)。路由防守在 `SampleOneRoutes.test.tsx`。 */
describe("示範項目詳情(/demo/sub/sample-one/view-page/:id)", () => {
  it("欄位表逐欄顯示;封面吃公開穩定網址直接顯示", async () => {
    renderSampleOne({ path: viewPath("demo-1") });

    expect(
      await screen.findByRole("heading", { name: "醬燒雞腿排" }),
    ).toBeInTheDocument();
    expect(screen.getByText("主食")).toBeInTheDocument();
    expect(screen.getByText("週末限定測試資料")).toBeInTheDocument();
    expect(screen.getByText("已發布")).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "醬燒雞腿排 的封面" }),
    ).toHaveAttribute("src", TEST_DEMO_COVER_URL);
  });

  it("有 show-internal-note:內部備註那一列看得到", async () => {
    renderSampleOne({ path: viewPath("demo-1") });

    expect(await screen.findByText("內部備註")).toBeInTheDocument();
    expect(screen.getByText("成本試算尚未確認")).toBeInTheDocument();
  });

  it("沒有 show-internal-note:整列不顯示(不是顯示空值)", async () => {
    renderSampleOne({ path: viewPath("demo-1"), permissions: VIEW_ONLY });

    await screen.findByRole("heading", { name: "醬燒雞腿排" });
    expect(screen.queryByText("內部備註")).not.toBeInTheDocument();
    expect(screen.queryByText("成本試算尚未確認")).not.toBeInTheDocument();
  });

  it("附件:顯示原始檔名與人類可讀大小", async () => {
    renderSampleOne({ path: viewPath("demo-1") });

    expect(await screen.findByText("成本試算 2026.png")).toBeInTheDocument();
    expect(screen.getByText("1.2 MB")).toBeInTheDocument();
    // 物件路徑的檔名不再拿來當顯示名
    expect(screen.queryByText("cost.png")).not.toBeInTheDocument();
  });

  it("附件:早期的舊資料(沒有原始檔名)退回路徑尾段、不顯示大小", async () => {
    renderSampleOne({
      path: viewPath("demo-legacy"),
      world: {
        items: [
          {
            ...demoItems[0],
            id: "demo-legacy",
            attachment: {
              path: "demo/66666666-7777-4888-8999-aaaaaaaaaaaa.pdf",
              name: null,
              size: null,
              contentType: null,
            },
          },
        ],
      },
    });

    expect(
      await screen.findByText("66666666-7777-4888-8999-aaaaaaaaaaaa.pdf"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d (B|KB|MB)$/)).not.toBeInTheDocument();
  });

  it("附件:按下「下載」才現簽短效網址,之前一次都不打", async () => {
    const { user: actor, fake } = renderSampleOne({ path: viewPath("demo-1") });

    expect(await screen.findByText("成本試算 2026.png")).toBeInTheDocument();
    expect(fake.calls.demoItemOneAttachmentUrl).toBe(0);

    await actor.click(screen.getByRole("button", { name: "下載" }));

    await waitFor(() => {
      expect(fake.calls.demoItemOneAttachmentUrl).toBe(1);
    });
    expect(
      await screen.findByRole("link", { name: "開啟下載連結" }),
    ).toHaveAttribute("href", TEST_DEMO_DOWNLOAD_URL);
  });

  it("建立者查不到那位使用者時顯示「—」(seed 示範資料的建立者是假 id)", async () => {
    renderSampleOne({ path: viewPath("demo-2") });

    await screen.findByRole("heading", { name: "涼拌小黃瓜" });
    // 「—」在好幾個沒填的欄位上都出現,所以對「建立者」那一格的值收斂
    expect(screen.getByText("建立者").nextSibling).toHaveTextContent("—");
  });

  it("改不動、刪不掉的那一筆只剩「返回列表」", async () => {
    renderSampleOne({ path: viewPath("demo-3") });

    await screen.findByRole("heading", { name: "古早味紅茶" });
    expect(
      screen.getByRole("button", { name: "← 返回列表" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刪除" }),
    ).not.toBeInTheDocument();
  });

  it("刪除:確認後回到列表", async () => {
    const { user: actor, fake } = renderSampleOne({ path: viewPath("demo-1") });
    await screen.findByRole("heading", { name: "醬燒雞腿排" });

    await actor.click(screen.getByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "確認刪除" }));

    await waitFor(() => {
      expect(fake.inputs.deleteDemoItemOne).toEqual([{ id: "demo-1" }]);
    });
    expect(await screen.findByTestId("location")).toHaveTextContent(
      SAMPLE_ONE_ROUTES.list,
    );
  });

  it("看不到的資料:api 回 NOT_FOUND,畫面講清楚不是壞掉", async () => {
    renderSampleOne({
      path: viewPath("demo-missing"),
      permissions: [
        SAMPLE_ONE_PERMISSIONS.view,
        SAMPLE_ONE_PERMISSIONS.showInternalNote,
      ],
    });

    expect(await screen.findByText(/找不到這筆示範項目/)).toBeInTheDocument();
  });
});
