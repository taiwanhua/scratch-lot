import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";
import { useState } from "react";

import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { DateFilterPicker } from "./DateFilterPicker";

interface HarnessProps {
  initial: string;
  /** 沒有條件(`""`)時畫面改顯示的預設值;不給 = 沒條件就空白(庫存、結帳清單那種) */
  fallback?: string;
}

/**
 * 篩選列的寫法:套用中的條件存在 state(實際頁面是網址),`""` 代表沒條件,
 * 有預設值的頁面(帳戶詳情的月初、現金帳的今天)把 `""` 換成預設值再傳給欄位。
 * 套用中的值印在 `output`,代表「查詢用的條件」。
 */
const Harness = ({ initial, fallback }: HarnessProps) => {
  const [applied, setApplied] = useState(initial);
  const shown = applied === "" ? (fallback ?? "") : applied;
  return (
    <>
      <DateFilterPicker
        label="期間起"
        value={shown}
        size="small"
        onChange={(next) => {
          setApplied(next ?? "");
        }}
      />
      <button
        type="button"
        onClick={() => {
          setApplied("2030-05-06");
        }}
      >
        外部改值
      </button>
      <output data-testid="applied">{applied}</output>
    </>
  );
};

const renderHarness = (props: HarnessProps) => {
  server.use(...authWorld({ hasRefreshCookie: true }).handlers);
  return renderApp({ path: "/overview", extra: <Harness {...props} /> });
};

const year = () => screen.getByRole("spinbutton", { name: "Year" });
const applied = () => screen.getByTestId("applied").textContent;

describe("DateFilterPicker", () => {
  it("有預設值的篩選:逐位打年份看得到 0002 → 0020 → 0202,查詢條件不動;打滿才套用", async () => {
    const { user } = renderHarness({ initial: "", fallback: "2026-10-01" });
    await user.click(await screen.findByRole("spinbutton", { name: "Year" }));

    const typed: (string | null)[] = [];
    const conditions: (string | null)[] = [];
    for (const key of "2025") {
      await user.keyboard(key);
      typed.push(year().textContent);
      conditions.push(applied());
    }

    expect(typed).toEqual(["0002", "0020", "0202", "2025"]);
    // 打到一半沒有送出條件(沒被換回預設的月初),打滿才套用
    expect(conditions).toEqual(["", "", "", "2025-10-01"]);
    expect(screen.getByRole("spinbutton", { name: "Month" })).toHaveFocus();
  });

  it("沒有預設值的篩選:打到一半不會先變成「不篩日期」,打滿才套用", async () => {
    const { user } = renderHarness({ initial: "2026-10-14" });
    await user.click(await screen.findByRole("spinbutton", { name: "Year" }));

    await user.keyboard("20");
    expect(year().textContent).toBe("0020");
    expect(applied()).toBe("2026-10-14");

    await user.keyboard("25");
    expect(applied()).toBe("2025-10-14");
  });

  it("清空就拿掉條件;有預設值的欄位回到預設值", async () => {
    const { user } = renderHarness({
      initial: "2026-09-15",
      fallback: "2026-10-01",
    });
    await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
    await user.keyboard("{Control>}a{/Control}{Backspace}");

    expect(applied()).toBe("");
    expect(screen.getByRole("group", { name: "期間起" })).toHaveTextContent(
      "2026-10-01",
    );
  });

  it("打到一半時外部換成別的值(快捷鍵、掃 QR 帶入)照常覆蓋", async () => {
    const { user } = renderHarness({ initial: "2026-10-14" });
    await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
    await user.keyboard("20");
    expect(year().textContent).toBe("0020");

    await user.click(screen.getByRole("button", { name: "外部改值" }));
    expect(applied()).toBe("2030-05-06");
    expect(screen.getByRole("group", { name: "期間起" })).toHaveTextContent(
      "2030-05-06",
    );
  });
});
