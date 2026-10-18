import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import {
  VIEW_ONLY,
  clickNode,
  detail,
  renderPage,
  treeLabel,
  waitForTree,
} from "./module-manager-test-support";

describe("模組與權限頁(/system/module-manager)", () => {
  it("左樹是治理面全樹:群組 / 隱藏節點標類型、已停用者標停用,預設選中第一個節點", async () => {
    renderPage();

    await waitForTree();
    expect(treeLabel("系統管理")).toBe("系統管理群組");
    // 側欄看不到的 hidden 節點與沒有路由的 api 樹,在這裡照樣列出來;
    // 沒有畫面的那種標「權限容器」而不是「隱藏頁」,不然會有人去找那個不存在的頁
    expect(treeLabel("API 能力")).toBe("API 能力權限容器");
    expect(treeLabel("租戶作業")).toBe("租戶作業權限容器");
    // 有畫面的隱藏節點仍是「隱藏頁」
    expect(treeLabel("編輯")).toBe("編輯隱藏頁停用");
    // 停用一律以標籤表示,不以「不回」表示(不然停用後就開不回來)
    expect(treeLabel("示範模組2")).toBe("示範模組2停用");
    // 連結是絕大多數節點的樣子,不掛類型標籤(Figma 89:218)
    expect(treeLabel("總覽")).toBe("總覽");

    // 預設選中第一棵樹的根
    expect(await within(detail()).findByText("overview")).toBeInTheDocument();
  });

  it("右面板顯示所選模組的 key / 側欄類型 / 排序 / 描述與權限清單", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    await clickNode(actor, "組織管理");

    const panel = within(detail());
    expect(await panel.findByText("system.org-manager")).toBeInTheDocument();
    expect(panel.getByText("模組連結")).toBeInTheDocument();
    expect(panel.getByText("維護組織樹與租戶")).toBeInTheDocument();

    // `<模組 key>.*` 恆排最前,其餘依 key
    const rows = within(
      panel.getByRole("table", { name: "權限清單" }),
    ).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("system.org-manager.*");
    expect(rows[2]).toHaveTextContent("system.org-manager.edit");
    expect(rows[3]).toHaveTextContent("system.org-manager.view");
  });

  /** 權限容器沒有畫面,右面板要講清楚它為什麼存在,不然只看到「隱藏」很難懂。 */
  it("選到權限容器時,側欄類型那一列說明它只掛權限、沒有畫面", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    await clickNode(actor, "API 能力");

    const panel = within(detail());
    expect(await panel.findByText("api")).toBeInTheDocument();
    expect(panel.getByText("權限容器")).toBeInTheDocument();
    expect(
      panel.getByText(
        "這一層只掛權限、沒有畫面,讓這些權限可以單獨授予或停用。",
      ),
    ).toBeInTheDocument();
  });

  it("群組節點沒有自己的權限時,權限清單顯示空狀態", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    await clickNode(actor, "示範群組");

    expect(
      await within(detail()).findByText("這個模組這一層沒有宣告權限"),
    ).toBeInTheDocument();
  });

  it("只有檢視權限時:開關一個都不出現,狀態改以標籤呈現", async () => {
    const { user: actor } = renderPage({ permissions: VIEW_ONLY });

    await waitForTree();
    await clickNode(actor, "示範模組2");

    await within(detail()).findByText("demo.sample-two");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // 這個模組是停用的,標籤要看得出來
    expect(within(detail()).getAllByText("已停用").length).toBeGreaterThan(0);
  });
});
