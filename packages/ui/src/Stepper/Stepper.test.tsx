import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  type StepStatus,
  Stepper,
  type StepperProgress,
  type StepperStep,
  activeStepIndex,
} from "./Stepper";

const LABELS = ["基本資料", "明細", "附件", "審核人", "確認"];

const stepsOf = (...statuses: StepStatus[]): StepperStep[] =>
  statuses.map((status, index) => ({
    key: `s${String(index + 1)}`,
    label: LABELS[index],
    status,
  }));

const progressText = ({ current, total, label }: StepperProgress) => (
  <>
    第 {current} / {total} 步 · {label}
  </>
);

const noop = () => {
  // 只看外觀
};

/**
 * 使用處的示範精靈(規格 10.8 的分工):步驟與內容只放畫面 state,上一步 / 下一步的條件由頁面決定,
 * 元件只回報點了哪一個已完成的步驟。
 */
const Wizard = ({ canLeave }: { canLeave: (step: number) => boolean }) => {
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [errors, setErrors] = useState<ReadonlySet<number>>(new Set());
  const [notes, setNotes] = useState<string[]>(LABELS.map(() => ""));
  const statusOf = (index: number): StepStatus => {
    if (errors.has(index)) {
      return "error";
    }
    if (index === current) {
      return "current";
    }
    return done.has(index) ? "done" : "todo";
  };
  return (
    <>
      <Stepper
        aria-label="申請步驟"
        variant="wide"
        steps={LABELS.map((label, index) => ({
          key: label,
          label,
          status: statusOf(index),
        }))}
        progressText={progressText}
        onStepClick={(_step, index) => {
          setCurrent(index);
        }}
      />
      <label>
        {`${LABELS[current] ?? ""}備註`}
        <input
          value={notes[current] ?? ""}
          onChange={(event) => {
            setNotes(
              notes.map((note, index) =>
                index === current ? event.target.value : note,
              ),
            );
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          if (!canLeave(current)) {
            setErrors(new Set([...errors, current]));
            return;
          }
          setErrors(new Set([...errors].filter((index) => index !== current)));
          setDone(new Set([...done, current]));
          setCurrent(current + 1);
        }}
      >
        下一步
      </button>
    </>
  );
};

const stepItem = (name: string): HTMLElement => {
  const item = screen
    .getAllByRole("listitem")
    .find((candidate) => candidate.textContent.includes(name));
  if (item === undefined) {
    throw new Error(`找不到步驟「${name}」`);
  }
  return item;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "matchMedia");
});

describe("Stepper:規格 10.8 的操作表", () => {
  it("按 [下一步]:頁面判斷可以前進 → 目前步驟標「已完成」,下一步標「進行中」", async () => {
    const user = userEvent.setup();
    render(<Wizard canLeave={() => true} />);

    expect(stepItem("基本資料")).toHaveAttribute("aria-current", "step");
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // 已完成 = 可點回的按鈕;進行中的不是按鈕
    expect(
      within(stepItem("基本資料")).getByRole("button", { name: "基本資料" }),
    ).toBeInTheDocument();
    expect(stepItem("明細")).toHaveAttribute("aria-current", "step");
    expect(within(stepItem("明細")).queryByRole("button")).toBeNull();
  });

  it("點已完成的步驟:回到那一步,之後的步驟內容保留", async () => {
    const user = userEvent.setup();
    render(<Wizard canLeave={() => true} />);

    await user.type(
      screen.getByRole("textbox", { name: "基本資料備註" }),
      "甲",
    );
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.type(screen.getByRole("textbox", { name: "明細備註" }), "乙");
    await user.click(screen.getByRole("button", { name: "基本資料" }));

    expect(stepItem("基本資料")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("textbox", { name: "基本資料備註" })).toHaveValue(
      "甲",
    );
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("textbox", { name: "明細備註" })).toHaveValue("乙");
  });

  it("只有已完成的步驟可點:未開始、進行中、有錯的都不是按鈕,也不回報", async () => {
    const user = userEvent.setup();
    const onStepClick = jest.fn();
    render(
      <Stepper
        variant="wide"
        steps={stepsOf("done", "error", "current", "todo", "todo")}
        progressText={progressText}
        onStepClick={onStepClick}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    for (const name of ["明細", "附件", "審核人", "確認"]) {
      await user.click(screen.getByText(name));
    }
    expect(onStepClick).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "基本資料" }));
    expect(onStepClick).toHaveBeenCalledTimes(1);
    expect(onStepClick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "s1" }),
      0,
    );
  });

  it("某步驟驗證失敗:那一步標「有錯」(驚嘆號、仍停在這一步)", async () => {
    const user = userEvent.setup();
    render(<Wizard canLeave={(step) => step !== 0} />);

    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(within(stepItem("基本資料")).getByText("!")).toBeInTheDocument();
    expect(stepItem("基本資料")).toHaveAttribute("aria-current", "step");
    expect(within(stepItem("基本資料")).queryByRole("button")).toBeNull();
  });

  it("重新整理 / 關閉 / 取消:從第 1 步開始,什麼都不留(不進網址、不存瀏覽器)", async () => {
    const user = userEvent.setup();
    const url = globalThis.location.href;
    const first = render(<Wizard canLeave={() => true} />);
    await user.type(
      screen.getByRole("textbox", { name: "基本資料備註" }),
      "甲",
    );
    await user.click(screen.getByRole("button", { name: "下一步" }));
    first.unmount();

    render(<Wizard canLeave={() => true} />);

    expect(stepItem("基本資料")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("textbox", { name: "基本資料備註" })).toHaveValue(
      "",
    );
    expect(globalThis.location.href).toBe(url);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("窄螢幕:只顯示「第 n / N 步 · 名稱」(目前那一步),沒有逐步的清單", () => {
    render(
      <Stepper
        variant="narrow"
        aria-label="申請步驟"
        steps={stepsOf("done", "current", "todo", "todo", "todo")}
        progressText={progressText}
        onStepClick={noop}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "申請步驟" }),
    ).toHaveTextContent("第 2 / 5 步 · 明細");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("不給 variant:畫面比 sm 窄用窄版,否則寬版", () => {
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: () => false,
      }),
    });
    render(
      <Stepper
        steps={stepsOf("done", "done", "current", "todo", "todo")}
        progressText={progressText}
      />,
    );

    expect(screen.getByText("第 3 / 5 步 · 附件")).toBeInTheDocument();
  });
});

describe("activeStepIndex", () => {
  it("第一個進行中;沒有就第一個有錯;全部完成取最後一步", () => {
    expect(activeStepIndex(stepsOf("done", "error", "current"))).toBe(2);
    expect(activeStepIndex(stepsOf("done", "error", "todo"))).toBe(1);
    expect(activeStepIndex(stepsOf("done", "done"))).toBe(1);
    expect(activeStepIndex([])).toBe(0);
  });
});
