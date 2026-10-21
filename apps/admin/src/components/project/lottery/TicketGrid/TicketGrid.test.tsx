import { describe, expect, it } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import {
  TicketGrid,
  type TicketGridCell,
  type TicketGridProps,
} from "./TicketGrid";

const Providers = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
    <AppThemeProvider brand={defaultBrand}>{children}</AppThemeProvider>
  </IntlProvider>
);

const ticketNo = (value: number) => String(value).padStart(3, "0");

/** 001–030:005 已售、025 在別的收銀點,其餘未售。 */
const CELLS: TicketGridCell[] = Array.from({ length: 30 }, (_, index) => {
  const value = index + 1;
  if (value === 5) {
    return { ticketNo: ticketNo(value), state: "sold" };
  }
  if (value === 25) {
    return {
      ticketNo: ticketNo(value),
      state: "otherCashPoint",
      tooltip: "店外攤位",
    };
  }
  return { ticketNo: ticketNo(value), state: "unsold" };
});

type HarnessProps = Partial<
  Omit<TicketGridProps, "selected" | "onSelectedChange">
>;

/** 受控的格子(已選放在 state,和使用處一樣)。 */
const Harness = (props: HarnessProps) => {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <TicketGrid
      cells={CELLS}
      selectableStates={["unsold"]}
      legendItems={["unsold", "sold", "selected"]}
      {...props}
      selected={selected}
      onSelectedChange={setSelected}
    />
  );
};

const cell = (value: number) =>
  within(screen.getByRole("group", { name: "張數格子" })).getByRole("button", {
    name: new RegExp(`^#${ticketNo(value)} `),
  });

const selectedNos = () =>
  within(screen.getByRole("group", { name: "張數格子" }))
    .queryAllByRole("button", { pressed: true })
    .map((button) => button.textContent);

describe("TicketGrid(規格 7.5 張數格子)", () => {
  it("每列 10 格;點一格選取、再點取消", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    expect(
      within(screen.getByRole("group", { name: "張數格子" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(30);
    await user.click(cell(12));
    expect(selectedNos()).toEqual(["012"]);
    expect(cell(12)).toHaveAccessibleName("#012 已選");
    await user.click(cell(12));
    expect(selectedNos()).toEqual([]);
  });

  it("Shift 連選:起點到終點之間能選的全部加入,不能選的跳過", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(cell(3));
    await user.keyboard("{Shift>}");
    await user.click(cell(7));
    await user.keyboard("{/Shift}");
    expect(selectedNos()).toEqual(["003", "004", "006", "007"]);
    expect(cell(5)).toBeDisabled();
  });

  it("連號快選 + 區段文字「#012–016、#020(6 張)」", async () => {
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.type(
      screen.getByRole("textbox", { name: "連號快選的起號" }),
      "012",
    );
    await user.type(
      screen.getByRole("textbox", { name: "連號快選的迄號" }),
      "016",
    );
    await user.click(screen.getByRole("button", { name: "加入" }));
    await user.click(cell(20));
    expect(selectedNos()).toEqual(["012", "013", "014", "015", "016", "020"]);
    expect(
      screen.getByText("已選 #012–016、#020(6 張) · Shift 可連選"),
    ).toBeInTheDocument();
  });

  it("圖例只顯示傳入的項目;文字可覆寫(格子的念法跟著變)", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        legendItems={["unsold", "selected"]}
        labels={{ selected: "在(已點)", unsold: "未點" }}
        quickSelect={false}
      />,
      { wrapper: Providers },
    );
    const legend = screen.getByRole("list", { name: "格子圖例" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["未點", "在(已點)"]);
    expect(within(legend).queryByText("已售")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "連號快選的起號" }),
    ).not.toBeInTheDocument();
    await user.click(cell(1));
    expect(cell(1)).toHaveAccessibleName("#001 在(已點)");
  });

  it("已選上限:點滿就不再加入(拆本標跳號)", async () => {
    const user = userEvent.setup();
    render(<Harness maxSelected={2} summary={false} />, {
      wrapper: Providers,
    });
    await user.click(cell(1));
    await user.click(cell(2));
    await user.click(cell(3));
    expect(selectedNos()).toEqual(["001", "002"]);
    expect(screen.queryByText(/Shift 可連選/)).not.toBeInTheDocument();
  });

  it("可以選的狀態由使用處決定(例:把在別的收銀點設成能選)", async () => {
    const user = userEvent.setup();
    render(<Harness selectableStates={["unsold", "otherCashPoint"]} />, {
      wrapper: Providers,
    });
    await user.click(cell(25));
    expect(selectedNos()).toEqual(["025"]);
  });
});
