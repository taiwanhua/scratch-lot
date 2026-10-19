import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import type { TagPaletteKey } from "@/lib/project/tag-palettes";

import { TagPaletteSelect } from "./TagPaletteSelect";

const Providers = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
    <AppThemeProvider brand={defaultBrand}>{children}</AppThemeProvider>
  </IntlProvider>
);

const PALETTE_NAMES = [
  "藍",
  "青",
  "綠",
  "萊姆",
  "黃",
  "橘",
  "紅",
  "粉",
  "紫",
  "灰",
];

describe("TagPaletteChip(色票標籤)", () => {
  it("顯示色票名稱,並標出代號", () => {
    render(
      <Providers>
        <TagPaletteChip paletteKey="orange" />
      </Providers>,
    );
    const chip = screen.getByText("橘").closest("[data-palette]");
    expect(chip).toHaveAttribute("data-palette", "orange");
  });

  it("可以換成呼叫端的字(例:選項名稱),顏色仍是那組色票", () => {
    render(
      <Providers>
        <TagPaletteChip paletteKey="green" label="補貨" />
      </Providers>,
    );
    expect(screen.getByText("補貨").closest("[data-palette]")).toHaveAttribute(
      "data-palette",
      "green",
    );
    expect(screen.queryByText("綠")).not.toBeInTheDocument();
  });

  it("無值(null)時不畫任何東西", () => {
    const { container } = render(
      <Providers>
        <TagPaletteChip paletteKey={null} />
      </Providers>,
    );
    expect(container.querySelector("[data-palette]")).toBeNull();
  });
});

describe("TagPaletteSelect(色票下拉)", () => {
  const setup = (value: TagPaletteKey | null) => {
    const onChange = jest.fn<(next: TagPaletteKey | null) => void>();
    const user = userEvent.setup();
    render(
      <Providers>
        <TagPaletteSelect
          value={value}
          onChange={onChange}
          label="「補貨」的顏色"
          hiddenLabel
        />
      </Providers>,
    );
    return { onChange, user };
  };

  it("只列「不設定」+ 十組色票,依固定順序;沒有可以輸入色碼的地方", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("combobox", { name: "「補貨」的顏色" }));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "不設定",
      ...PALETTE_NAMES,
    ]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("選取一組色票 → onChange 收到代號", async () => {
    const { onChange, user } = setup(null);
    await user.click(screen.getByRole("combobox", { name: "「補貨」的顏色" }));
    await user.click(await screen.findByRole("option", { name: "橘" }));
    expect(onChange).toHaveBeenCalledWith("orange");
  });

  it("有值時收合狀態顯示那一組;選「不設定」→ onChange 收到 null", async () => {
    const { onChange, user } = setup("cyan");
    const combobox = screen.getByRole("combobox", { name: "「補貨」的顏色" });
    expect(within(combobox).getByText("青")).toBeInTheDocument();
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: "不設定" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("無值時收合狀態顯示「不設定」", () => {
    setup(null);
    expect(
      within(
        screen.getByRole("combobox", { name: "「補貨」的顏色" }),
      ).getByText("不設定"),
    ).toBeInTheDocument();
  });
});
