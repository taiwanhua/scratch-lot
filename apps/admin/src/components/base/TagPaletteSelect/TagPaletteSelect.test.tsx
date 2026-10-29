import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";

import type { TagPaletteKey } from "@repo/domain/tag-palette";
import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { TagPaletteChip } from "@/components/base/TagPaletteChip/TagPaletteChip";

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
        <TagPaletteChip paletteKey="green" label="炸物" />
      </Providers>,
    );
    expect(screen.getByText("炸物").closest("[data-palette]")).toHaveAttribute(
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

describe("TagPaletteSelect(標籤 + 色票面板)", () => {
  const NAME = "「炸物」的顏色";

  const setup = (value: TagPaletteKey | null) => {
    const onChange = jest.fn<(next: TagPaletteKey | null) => void>();
    const user = userEvent.setup();
    render(
      <Providers>
        <TagPaletteSelect value={value} onChange={onChange} label={NAME} />
      </Providers>,
    );
    return { onChange, user };
  };

  const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: NAME }));
    return screen.findByRole("dialog", { name: "選擇顏色" });
  };

  it("觸發就是色票標籤本身(不是下拉框):有值顯示那一組", () => {
    setup("cyan");
    const trigger = screen.getByRole("button", { name: NAME });
    expect(trigger).toHaveAttribute("data-palette", "cyan");
    expect(within(trigger).getByText("青")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("無值時觸發是「不設定」", () => {
    setup(null);
    expect(screen.getByRole("button", { name: NAME })).toHaveTextContent(
      "不設定",
    );
  });

  it("面板:標題「選擇顏色」、十組色票兩列各 5 個、下方「不設定」;沒有可以輸入色碼的地方", async () => {
    const { user } = setup(null);
    const panel = await openPanel(user);
    const chips = [...panel.querySelectorAll("[data-palette]")];
    expect(chips.map((chip) => chip.textContent)).toEqual(PALETTE_NAMES);
    const rows = [...new Set(chips.map((chip) => chip.parentElement))];
    expect(rows.map((row) => row?.children.length)).toEqual([5, 5]);
    expect(
      within(panel).getByRole("button", { name: "不設定" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("在面板裡點一組色票 → onChange 收到代號,面板關閉", async () => {
    const { onChange, user } = setup(null);
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole("button", { name: "橘" }));
    expect(onChange).toHaveBeenCalledWith("orange");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("目前的那一組在面板裡標成已選;點「不設定」→ onChange 收到 null", async () => {
    const { onChange, user } = setup("cyan");
    const panel = await openPanel(user);
    expect(within(panel).getByRole("button", { name: "青" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(panel).getByRole("button", { name: "不設定" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
