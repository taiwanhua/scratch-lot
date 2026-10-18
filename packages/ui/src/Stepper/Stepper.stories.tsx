import type { Meta, StoryObj } from "@storybook/react-vite";

import { type StepStatus, Stepper, type StepperStep } from "./Stepper";

const LABELS = ["基本資料", "明細", "附件", "審核人", "確認"];

/** 五步(Figma 示範卡的步驟名),狀態依序給。 */
const stepsOf = (...statuses: StepStatus[]): StepperStep[] =>
  statuses.map((status, index) => ({
    key: `step-${String(index + 1)}`,
    label: LABELS[index],
    status,
  }));

const meta = {
  title: "Components/Stepper",
  component: Stepper,
  args: {
    "aria-label": "申請步驟",
    variant: "wide",
    steps: stepsOf("done", "current", "todo", "todo", "todo"),
    progressText: ({ current, total, label }) => (
      <>
        第 {current} / {total} 步 · {label}
      </>
    ),
    onStepClick: () => {
      // story 只看外觀;回到哪一步由使用處決定
    },
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 寬:第 1 步進行中,其餘未開始。 */
export const WideFirstStep: Story = {
  args: { steps: stepsOf("current", "todo", "todo", "todo", "todo") },
};

/** 寬:已完成 → 進行中 → 未開始(已完成的可點回)。 */
export const WideInProgress: Story = {};

/** 寬:Figma「有錯的步驟」,明細驗證失敗標「有錯」。 */
export const WideWithError: Story = {
  args: { steps: stepsOf("done", "error", "current", "todo", "todo") },
};

/** 寬:全部完成(最後一步待送出時)。 */
export const WideAllDone: Story = {
  args: { steps: stepsOf("done", "done", "done", "done", "done") },
};

/** 窄:只顯示「第 n / N 步 · 名稱」+ 分段進度條。 */
export const NarrowFirstStep: Story = {
  args: {
    variant: "narrow",
    steps: stepsOf("current", "todo", "todo", "todo", "todo"),
  },
};

export const NarrowInProgress: Story = { args: { variant: "narrow" } };

export const NarrowWithError: Story = {
  args: {
    variant: "narrow",
    steps: stepsOf("done", "error", "current", "todo", "todo"),
  },
};

export const NarrowAllDone: Story = {
  args: {
    variant: "narrow",
    steps: stepsOf("done", "done", "done", "done", "done"),
  },
};
