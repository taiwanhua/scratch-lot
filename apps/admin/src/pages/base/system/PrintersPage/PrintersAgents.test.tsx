import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { PrintAgentPlatform } from "@repo/graphql";

import { agentFragment } from "@/test/msw/printing-fixtures";
import { TEST_PAIRING_CODE } from "@/test/msw/printing-handlers";
import { findSnackbarAlert } from "@/test/snackbar";
import { setupFakeViewport } from "@/test/viewport";

import { renderPrinters } from "./printers-test-support";

setupFakeViewport();

beforeAll(async () => {
  await import("./PrintersPage");
});

const AGENTS_PATH = "/system/printers?tab=agents";

/** 攔下下載連結的點擊(jsdom 會嘗試導覽);記下 href 與檔名。 */
const clickedDownloads: { href: string; download: string }[] = [];
const onDocumentClick = (event: MouseEvent) => {
  const link = event.target;
  if (link instanceof HTMLAnchorElement && link.download !== "") {
    event.preventDefault();
    clickedDownloads.push({ href: link.href, download: link.download });
  }
};
const originalUserAgent = navigator.userAgent;

beforeEach(() => {
  clickedDownloads.length = 0;
  document.addEventListener("click", onDocumentClick);
});

afterEach(() => {
  document.removeEventListener("click", onDocumentClick);
  Object.defineProperty(navigator, "userAgent", {
    value: originalUserAgent,
    configurable: true,
  });
});

const agentRow = (table: HTMLElement, name: string) =>
  within(within(table).getByText(name).closest("tr") as HTMLElement);

describe("印表機管理:代理程式分頁", () => {
  it("清單:狀態、最後連線、版本;舊版代理程式標示「請更新」", async () => {
    renderPrinters({ path: AGENTS_PATH });

    const table = await screen.findByRole("table", { name: "代理程式" });
    await within(table).findByText("櫃台電腦");
    const counter = agentRow(table, "櫃台電腦");
    expect(counter.getByText("已連線")).toBeInTheDocument();
    expect(counter.getByText("1.2.0")).toBeInTheDocument();
    expect(counter.queryByText("請更新")).not.toBeInTheDocument();
    expect(counter.getByText("2026-10-16 22:01")).toBeInTheDocument();

    const store = agentRow(table, "倉庫電腦");
    expect(store.getByText("離線")).toBeInTheDocument();
    expect(store.getByText("1.1.0")).toBeInTheDocument();
    expect(store.getByText("請更新")).toBeInTheDocument();
  });

  it("預設只列啟用中的;打開「顯示已停用」才列出已停用的,已停用的列上沒有 [重新配對] [停用]", async () => {
    const { user, printing } = renderPrinters({
      path: AGENTS_PATH,
      world: {
        agents: [
          agentFragment(),
          agentFragment({
            id: "agent-old",
            name: "舊電腦",
            enabled: false,
            paired: false,
            online: false,
          }),
        ],
      },
    });

    const table = await screen.findByRole("table", { name: "代理程式" });
    await within(table).findByText("櫃台電腦");
    expect(within(table).queryByText("舊電腦")).not.toBeInTheDocument();
    expect(
      printing.inputs.agents.some(
        (input) => input.includeDisabled === false && input.page === 1,
      ),
    ).toBe(true);

    await user.click(screen.getByRole("switch", { name: "顯示已停用" }));
    expect(await within(table).findByText("舊電腦")).toBeInTheDocument();
    expect(globalThis.location.search).toContain("showDisabled");
    const old = agentRow(table, "舊電腦");
    expect(old.getByText("已停用")).toBeInTheDocument();
    expect(old.queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "重新配對「櫃台電腦」" }),
    ).toBeInTheDocument();
  });

  it("下載按鈕:依瀏覽器系統反白建議的那個;按下才向 api 要簽名網址並開始下載", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux aarch64) Chrome/141.0",
      configurable: true,
    });
    const { user, printing } = renderPrinters({ path: AGENTS_PATH });

    expect(
      await screen.findByText("列印代理程式 · 最新版本 1.2.0"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "下載 Linux arm64(建議)" }),
    ).toBeInTheDocument();
    expect(printing.inputs.download).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "下載 Windows x64" }));
    await waitFor(() => {
      expect(clickedDownloads).toHaveLength(1);
    });
    expect(printing.inputs.download).toEqual([
      { platform: PrintAgentPlatform.WindowsX64 },
    ]);
    expect(clickedDownloads[0].href).toContain(
      "https://storage.example.test/print-agent/1.2.0/",
    );
  });

  it("還沒發布安裝檔:顯示說明,不顯示下載按鈕", async () => {
    renderPrinters({
      path: AGENTS_PATH,
      world: { release: { latestVersion: null, files: [] } },
    });

    expect(await screen.findByText(/還沒有可下載的安裝檔/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^下載/ }),
    ).not.toBeInTheDocument();
  });

  it("[新增代理程式]:選組織、填名稱 → 同一個對話框顯示伺服器網址與配對碼,各可複製", async () => {
    const { user, printing } = renderPrinters({ path: AGENTS_PATH });
    // userEvent 的剪貼簿替身讀回時與 jsdom 的 Blob 不相容:直接記下寫入的文字
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    await user.click(
      await screen.findByRole("button", { name: "+ 新增代理程式" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增代理程式" });
    await user.click(within(dialog).getByRole("button", { name: "建立" }));
    expect(within(dialog).getAllByText("必填")).toHaveLength(2);
    expect(printing.inputs.createAgent).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("combobox", { name: /所屬組織/ }),
    );
    await user.click(
      await screen.findByRole("option", { name: "租戶 A / A-1 內容組" }),
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /名稱/ }),
      "收銀電腦",
    );
    await user.click(within(dialog).getByRole("button", { name: "建立" }));

    expect(await within(dialog).findByText("8K3M-Q7PZ")).toBeInTheDocument();
    expect(within(dialog).getByText("https://api.test")).toBeInTheDocument();
    expect(printing.inputs.createAgent).toEqual([
      { orgId: "org-content", name: "收銀電腦" },
    ]);

    await user.click(
      within(dialog).getByRole("button", { name: "複製配對碼" }),
    );
    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已複製配對碼",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "複製伺服器網址" }),
    );
    await waitFor(() => {
      expect(copied).toEqual([TEST_PAIRING_CODE, "https://api.test"]);
    });

    await user.click(within(dialog).getByRole("button", { name: "完成" }));
    const table = screen.getByRole("table", { name: "代理程式" });
    expect(await within(table).findByText("收銀電腦")).toBeInTheDocument();
    expect(
      agentRow(table, "收銀電腦").getByText("等待配對"),
    ).toBeInTheDocument();
  });

  it("[重新配對]:確認後顯示新的配對碼", async () => {
    const { user, printing } = renderPrinters({ path: AGENTS_PATH });

    await user.click(
      await screen.findByRole("button", { name: "重新配對「櫃台電腦」" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "重新配對「櫃台電腦」",
    });
    expect(within(dialog).queryByText("8K3M-Q7PZ")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "重新配對" }));

    expect(await within(dialog).findByText("8K3M-Q7PZ")).toBeInTheDocument();
    expect(printing.inputs.resetPairing).toEqual(["agent-counter"]);
  });

  it("[停用]:確認後停用,預設清單不再列出", async () => {
    const { user, printing } = renderPrinters({ path: AGENTS_PATH });

    await user.click(
      await screen.findByRole("button", { name: "停用「倉庫電腦」" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "停用「倉庫電腦」?",
    });
    await user.click(within(dialog).getByRole("button", { name: "停用" }));

    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已停用代理程式",
    });
    expect(printing.inputs.disableAgent).toEqual(["agent-store"]);
    const table = screen.getByRole("table", { name: "代理程式" });
    await waitFor(() => {
      expect(within(table).queryByText("倉庫電腦")).not.toBeInTheDocument();
    });
  });
});
