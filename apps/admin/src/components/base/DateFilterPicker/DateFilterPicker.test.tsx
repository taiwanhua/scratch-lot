import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { DateFilterPicker } from "./DateFilterPicker";

interface HarnessProps {
  initial: string;
  /** 沒有條件(`""`)時畫面改顯示的預設值;不給 = 沒條件就空白 */
  fallback?: string;
}

/**
 * 篩選列的寫法:套用中的條件存在 state(實際頁面是網址),`""` 代表沒條件,
 * 有預設值的頁面(例:預設月初或今天的期間篩選)把 `""` 換成預設值再傳給欄位。
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
      <button type="button">別處</button>
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

  describe("打到一半就離開欄位:畫面還原成套用中的值(與查詢一致)", () => {
    it("有預設值:還原成預設的月初,條件不變", async () => {
      const { user } = renderHarness({ initial: "", fallback: "2026-10-01" });
      await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
      await user.keyboard("20");
      expect(year().textContent).toBe("0020");

      await user.click(screen.getByRole("button", { name: "別處" }));
      expect(applied()).toBe("");
      // 焦點落定後才還原(等 blur 之後有沒有 focus 冒回來)
      await waitFor(() => {
        expect(screen.getByRole("group", { name: "期間起" })).toHaveTextContent(
          "2026-10-01",
        );
      });
    });

    it("套用中有日期:還原成那一天", async () => {
      const { user } = renderHarness({ initial: "2026-10-14" });
      await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
      await user.keyboard("20");

      await user.click(screen.getByRole("button", { name: "別處" }));
      expect(applied()).toBe("2026-10-14");
      // 焦點落定後才還原(等 blur 之後有沒有 focus 冒回來)
      await waitFor(() => {
        expect(screen.getByRole("group", { name: "期間起" })).toHaveTextContent(
          "2026-10-14",
        );
      });
    });

    it("沒有條件:清掉打到一半的字,回到格式提示", async () => {
      const { user } = renderHarness({ initial: "" });
      await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
      await user.keyboard("20");
      expect(year().textContent).toBe("0020");

      await user.click(screen.getByRole("button", { name: "別處" }));
      expect(applied()).toBe("");
      // 焦點落定後才還原(等 blur 之後有沒有 focus 冒回來)
      await waitFor(() => {
        expect(screen.getByRole("group", { name: "期間起" })).toHaveTextContent(
          "YYYY-MM-DD",
        );
      });
    });

    it("切到別的視窗(文件失去焦點)不算離開:不重掛,回來還能接著打", async () => {
      const { user } = renderHarness({ initial: "2026-10-14" });
      await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
      await user.keyboard("20");
      const section = year();

      const hasFocus = jest.spyOn(document, "hasFocus").mockReturnValue(false);
      try {
        fireEvent.blur(section);
        // 等 blur 之後的計時器跑完
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
        });
      } finally {
        hasFocus.mockRestore();
      }

      expect(year()).toBe(section);
      expect(year().textContent).toBe("0020");
    });

    it("在欄位裡換區段、打開日曆不算離開:草稿留著,在日曆點一天照常套用", async () => {
      const { user } = renderHarness({ initial: "2026-10-14" });
      await user.click(await screen.findByRole("spinbutton", { name: "Year" }));
      await user.keyboard("20");
      await user.click(screen.getByRole("spinbutton", { name: "Day" }));
      expect(year().textContent).toBe("0020");

      await user.click(screen.getByRole("button", { name: /choose date/i }));
      expect(year().textContent).toBe("0020");
      await user.click(await screen.findByRole("gridcell", { name: "15" }));
      expect(applied()).toMatch(/-15$/);
    });
  });
});
