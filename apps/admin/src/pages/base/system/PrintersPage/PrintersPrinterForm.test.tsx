import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { findSnackbarAlert } from "@/test/snackbar";
import { setupFakeViewport } from "@/test/viewport";

import { PRINTERS_PERMISSIONS } from "./printers-permissions";
import { renderPrinters } from "./printers-test-support";

setupFakeViewport();

beforeAll(async () => {
  await import("./PrintersPage");
});

describe("印表機管理:新增 / 編輯印表機", () => {
  it("新增:必填擋下;選組織後才列該組織的代理程式;送出的欄位", async () => {
    const { user, printing } = renderPrinters();

    await user.click(
      await screen.findByRole("button", { name: "+ 新增印表機" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "新增印表機" });
    // 新增的一律啟用,沒有開關
    expect(
      within(dialog).queryByRole("switch", { name: "啟用" }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(printing.inputs.createPrinter).toHaveLength(0);
    expect(within(dialog).getAllByText("必填").length).toBeGreaterThan(0);

    await user.click(
      within(dialog).getByRole("combobox", { name: /所屬組織/ }),
    );
    // 只列有啟用中代理程式的組織
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["租戶 A / A-1 內容組", "租戶 A / A-2 台北分店"]);
    await user.click(
      within(listbox).getByRole("option", { name: "租戶 A / A-2 台北分店" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: /代理程式/ }),
    );
    const agents = await screen.findByRole("listbox");
    expect(
      within(agents)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["倉庫電腦 · 離線"]);
    await user.click(within(agents).getByRole("option"));

    await user.type(
      within(dialog).getByRole("textbox", { name: /名稱/ }),
      "後場收據機",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /IP 位址/ }),
      "192.0.2.70",
    );
    const port = within(dialog).getByRole("textbox", { name: /Port/ });
    await user.clear(port);
    await user.type(port, "70000");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(dialog).getByText("請填 1–65535 的數字")).toBeInTheDocument();
    expect(printing.inputs.createPrinter).toHaveLength(0);

    await user.clear(port);
    await user.type(port, "9100");
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "設為這個組織的預設印表機",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已新增印表機",
    });
    expect(printing.inputs.createPrinter).toEqual([
      {
        agentId: "agent-store",
        name: "後場收據機",
        host: "192.0.2.70",
        port: 9100,
        paperWidth: 58,
        isDefault: true,
      },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "印表機" });
    expect(await within(table).findByText("後場收據機")).toBeInTheDocument();
  });

  it("編輯記在網址(?edit=):帶入那一台;改名與停用各送一次,關掉後清掉參數", async () => {
    const { user, printing } = renderPrinters();

    await user.click(
      await screen.findByRole("button", { name: "編輯「櫃台收據機」" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "編輯印表機" });
    expect(globalThis.location.search).toContain("edit=printer-counter");
    const name = within(dialog).getByRole("textbox", { name: /名稱/ });
    expect(name).toHaveValue("櫃台收據機");
    // 編輯不能換組織
    expect(
      within(dialog).getByRole("combobox", { name: /所屬組織/ }),
    ).toHaveAttribute("aria-disabled", "true");

    await user.clear(name);
    await user.type(name, "前台收據機");
    await user.click(within(dialog).getByRole("switch", { name: "啟用" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(await findSnackbarAlert()).toEqual({
      severity: "success",
      text: "已儲存印表機",
    });
    expect(printing.inputs.updatePrinter.at(-1)).toMatchObject({
      id: "printer-counter",
      name: "前台收據機",
    });
    expect(printing.inputs.setPrinterEnabled).toEqual([
      { id: "printer-counter", enabled: false },
    ]);
    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("edit=");
    });
  });

  it("帶 ?edit= 進來:直接打開那一台", async () => {
    renderPrinters({ path: "/system/printers?edit=printer-store" });
    const dialog = await screen.findByRole("dialog", { name: "編輯印表機" });
    expect(within(dialog).getByRole("textbox", { name: /名稱/ })).toHaveValue(
      "倉庫收據機",
    );
  });

  it("沒有 edit 權限:帶 ?edit= 也不打開,參數清掉", async () => {
    renderPrinters({
      path: "/system/printers?edit=printer-store",
      permissions: [PRINTERS_PERMISSIONS.view],
    });
    const table = await screen.findByRole("table", { name: "印表機" });
    await within(table).findByText("倉庫收據機");
    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("edit=");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("?edit= 的那一台不在目前這一頁的清單:不打開、清掉參數,提示找不到這筆資料", async () => {
    renderPrinters({ path: "/system/printers?edit=printer-missing" });
    const table = await screen.findByRole("table", { name: "印表機" });
    await within(table).findByText("倉庫收據機");

    expect(await findSnackbarAlert()).toEqual({
      severity: "warning",
      text: "找不到這筆資料",
    });
    await waitFor(() => {
      expect(globalThis.location.search).not.toContain("edit=");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
