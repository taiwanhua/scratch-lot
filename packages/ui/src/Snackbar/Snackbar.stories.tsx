import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { Box } from "../Box/Box";
import { Stack } from "../Stack/Stack";
import {
  Snackbar,
  type SnackbarProps,
  type SnackbarSeverity,
} from "./Snackbar";
import { SnackbarStack } from "./SnackbarStack";

/** 卡片寬 360(Figma 元件寬;實際寬度由 `SnackbarStack` 給)。 */
const cardWidthDecorator: Decorator = (Story) => (
  <Box sx={{ width: 360 }}>
    <Story />
  </Box>
);

/**
 * Figma `Draft/Snackbar+`(Severity = Success / Error / Warning / Info)。
 * 卡片本身不定位;實際畫面上由 `SnackbarStack` 放在右下角(手機底部滿寬)並往上疊。
 * 暗色模式:工具列 Mode 切 dark,或看 `*Dark` 的 story。
 */
const meta = {
  title: "Components/Snackbar",
  component: Snackbar,
  args: {
    closeLabel: "關閉",
    message: "示範單據 #D-0031 · 200 元",
    autoHideDuration: null,
    onClose: () => {
      // story 只看外觀:關閉由呼叫端(app 的 SnackbarProvider)接手
    },
  },
  decorators: [cardWidthDecorator],
} satisfies Meta<typeof Snackbar>;

export default meta;
type Story = StoryObj<typeof meta>;

const SEVERITIES: readonly SnackbarSeverity[] = [
  "success",
  "error",
  "warning",
  "info",
];

const undo: NonNullable<SnackbarProps["action"]> = {
  label: "撤銷",
  onClick: () => {
    // story 只看外觀
  },
};

/** 四種 Severity × 有 / 無標題 × 有 / 無動作 的全組合矩陣。 */
const Matrix = (props: SnackbarProps) => (
  <Stack spacing={2}>
    {SEVERITIES.map((severity) => (
      <Stack key={severity} spacing={1}>
        <Snackbar {...props} severity={severity} />
        <Snackbar {...props} severity={severity} title="已售出" />
        <Snackbar {...props} severity={severity} action={undo} />
        <Snackbar {...props} severity={severity} title="已售出" action={undo} />
      </Stack>
    ))}
  </Stack>
);

export const Success: Story = { args: { severity: "success" } };
export const Failure: Story = { args: { severity: "error" } };
export const Warning: Story = { args: { severity: "warning" } };
export const Info: Story = { args: { severity: "info" } };

/** 有標題:粗體標題在訊息上方(新通知提示:Info + 標題、沒有動作)。 */
export const WithTitle: Story = {
  args: { severity: "info", title: "新通知", message: "你有 3 則新通知" },
};

/** 有動作(可撤銷):[撤銷] 在 ✕ 左邊,預設停留 8 秒。 */
export const WithAction: Story = {
  args: { severity: "success", title: "已售出", action: undo },
};

/** 長文案:換行,動作與 ✕ 維持垂直置中。 */
export const LongMessage: Story = {
  args: {
    severity: "error",
    message:
      "這個角色仍被 3 位使用者持有,請先解除授權後再刪除;若對象在管理範圍外,請聯絡該組織的管理員。",
  },
};

/** 四種 Severity × 有 / 無標題 × 有 / 無動作(亮色)。 */
export const AllVariants: Story = {
  render: (args) => <Matrix {...args} />,
};

/** 同一個矩陣在暗色模式:顏色全走主題 token,自動換暗色那一組。 */
export const AllVariantsDark: Story = {
  globals: { mode: "dark" },
  render: (args) => (
    <Box sx={{ bgcolor: "background.default", p: 2 }}>
      <Matrix {...args} />
    </Box>
  ),
};

/**
 * 實際位置與堆疊:電腦 / 平板右下角距邊 24,手機底部左右 16 滿寬(把畫布調窄看手機版);
 * 往上疊、新的在下面,最多 3 則。
 */
export const StackedOnScreen: Story = {
  decorators: [],
  render: (args) => (
    <SnackbarStack
      closeLabel={args.closeLabel}
      onClose={() => {
        // story 只看外觀
      }}
      items={[
        {
          id: 1,
          severity: "success",
          message: "已儲存",
          autoHideDuration: null,
        },
        {
          id: 2,
          severity: "info",
          title: "新通知",
          message: "你有 2 則新通知",
          autoHideDuration: null,
        },
        {
          id: 3,
          severity: "success",
          title: "已售出",
          message: "示範單據 #D-0031 · 200 元",
          action: undo,
          autoHideDuration: null,
        },
      ]}
    />
  ),
};

/** 堆疊在暗色模式。 */
export const StackedOnScreenDark: Story = {
  ...StackedOnScreen,
  globals: { mode: "dark" },
};
