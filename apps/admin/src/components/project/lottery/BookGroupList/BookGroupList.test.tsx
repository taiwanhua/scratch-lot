import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { BookScanBar } from "../BookScanBar/BookScanBar";
import {
  BookGroupList,
  type BookListGroup,
  type BookListLabels,
  type BookListMode,
} from "./BookGroupList";

const Providers = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
    <AppThemeProvider brand={defaultBrand}>{children}</AppThemeProvider>
  </IntlProvider>
);

const LABELS: BookListLabels = {
  columns: {
    bookNo: "本號",
    ticket: "最後張號",
    tickets: "張數",
    bookPrice: "整本金額",
    rate: "批購金額率",
    amount: "批購金額",
    status: "狀態",
  },
  status: { received: "已點收", notReceived: "未點收", inTransit: "在途" },
  remove: "移除",
  rateOf: (row) => `本號 ${row.bookNo} 的批購金額率`,
  cardFacts: (row) => `最後張號 ${row.ticketText}`,
};

const row = (
  rowId: string,
  bookNo: string,
  overrides: Partial<BookListGroup["rows"][number]> = {},
) => ({
  rowId,
  bookNo,
  ticketText: "100",
  tickets: 100,
  bookPrice: 20_000,
  rate: 92,
  amount: 18_400,
  ...overrides,
});

const renderList = (
  mode: BookListMode,
  rows: BookListGroup["rows"],
  extra: { scanBar?: ReactNode } = {},
) => {
  const onRate = jest.fn();
  const onRemove = jest.fn();
  render(
    <Providers>
      <BookGroupList
        mode={mode}
        title="明細"
        labels={LABELS}
        groups={[
          {
            key: "game-5164",
            title: "5164 發大財",
            caption: "已點收 1 / 2",
            rows,
          },
        ]}
        onRate={onRate}
        onRemove={onRemove}
        {...extra}
      />
    </Providers>,
  );
  return { onRate, onRemove };
};

/** 依遊戲分組的本清單:模式決定能不能改,鎖住的列唯讀並標狀態(規格 8.2、8.4)。 */
describe("BookGroupList", () => {
  it("新增:每本可改批購金額率、可移除;沒有狀態欄", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderList("create", [row("r1", "056527")]);
    const table = screen.getByRole("table", { name: "5164 發大財" });
    expect(
      within(table).getByRole("spinbutton", {
        name: "本號 056527 的批購金額率",
      }),
    ).toHaveValue(92);
    expect(
      within(table).queryByRole("columnheader", { name: "狀態" }),
    ).toBeNull();
    await user.click(
      within(table).getByRole("button", { name: "移除 056527" }),
    );
    expect(onRemove).toHaveBeenCalledWith("r1");
  });

  it("編輯:已點收的列鎖住(沒有輸入框與 [移除])並標「已點收」;沒點收的列照常可改", () => {
    renderList("edit", [
      row("r1", "056527", { isLocked: true, status: "received" }),
      row("r5", "056531"),
    ]);
    const table = screen.getByRole("table", { name: "5164 發大財" });
    const [, locked, open] = within(table).getAllByRole("row");
    expect(within(locked).getByText("已點收")).toBeInTheDocument();
    expect(within(locked).getByText("92%")).toBeInTheDocument();
    expect(within(locked).queryByRole("spinbutton")).toBeNull();
    expect(within(locked).queryByRole("button")).toBeNull();
    expect(within(open).getByRole("spinbutton")).toBeInTheDocument();
    expect(
      within(open).getByRole("button", { name: "移除 056531" }),
    ).toBeInTheDocument();
    expect(screen.getByText("已點收 1 / 2")).toBeInTheDocument();
  });

  it("點收 / 檢視:唯讀,每本顯示狀態;刷條碼列由使用處給(檢視不給)", () => {
    renderList(
      "receive",
      [
        row("r1", "056527", { status: "received" }),
        row("r5", "056531", { status: "notReceived" }),
      ],
      {
        scanBar: (
          <BookScanBar
            purpose="test-receive"
            label="刷條碼點收"
            onScan={() => true}
          />
        ),
      },
    );
    const table = screen.getByRole("table", { name: "5164 發大財" });
    expect(within(table).queryByRole("spinbutton")).toBeNull();
    expect(within(table).queryByRole("button")).toBeNull();
    expect(within(table).getByText("未點收")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "刷條碼點收" }),
    ).toBeInTheDocument();
    // 點收平常不顯示「正面條碼的遊戲」
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("BookGroupList 平板 / 手機(卡片)", () => {
  restoreViewportAfterEach();

  it("每本一張卡片:鎖住的列只有狀態標籤;沒鎖的列有率輸入框與 [移除];在途可移除的列只有 [移除]", () => {
    setMobileViewport();
    renderList("edit", [
      row("r1", "056527", { isLocked: true, status: "received" }),
      row("r2", "056528", {
        isLocked: true,
        isRemovable: true,
        status: "inTransit",
      }),
      row("r5", "056531"),
    ]);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("已點收")).toBeInTheDocument();
    expect(screen.getByText("在途")).toBeInTheDocument();
    expect(
      screen.getAllByText((_text, node) => node?.textContent === "最後張號 100")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "移除 056527" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "移除 056528" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: "本號 056528 的批購金額率" }),
    ).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "本號 056531 的批購金額率" }),
    ).toHaveValue(92);
  });
});

describe("BookScanBar", () => {
  it("手動輸入後按 Enter → 交給使用處;成功清空、失敗保留原碼;提示在這一列正下方", async () => {
    const user = userEvent.setup();
    const results = [false, true];
    const onScan = jest.fn(
      (code: string) => code !== "" && (results.shift() ?? true),
    );
    const onGame = jest.fn();
    render(
      <Providers>
        <BookScanBar
          purpose="test-create"
          label="刷條碼加入"
          onScan={onScan}
          gamePicker={{
            label: "正面條碼的遊戲",
            noneLabel: "刷背面編號",
            options: [{ value: "game-5164", label: "5164 發大財" }],
            value: null,
            onChange: onGame,
          }}
          message={{ severity: "warning", text: "本號 056527 已經在這張單上" }}
        />
      </Providers>,
    );
    expect(
      screen.getByRole("combobox", { name: "正面條碼的遊戲" }),
    ).toBeInTheDocument();
    expect(screen.getByText("本號 056527 已經在這張單上")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "刷條碼加入" });
    await user.type(input, "0056527100{Enter}");
    expect(onScan).toHaveBeenLastCalledWith("0056527100");
    expect(input).toHaveValue("0056527100");
    await user.type(input, "{Enter}");
    expect(input).toHaveValue("");
  });
});
