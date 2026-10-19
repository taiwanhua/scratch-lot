import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { Switch } from "../Switch/Switch";
import { HelpIcon } from "../icons/HelpIcon";
import { Tooltip } from "./Tooltip";

const meta = {
  title: "Components/Tooltip",
  component: Tooltip,
  args: {
    title: "平台根組織不可停用",
    children: <Button variant="text">停用</Button>,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 預設貼在上方。 */
export const Default: Story = {};

export const Bottom: Story = { args: { placement: "bottom" } };

export const WithArrow: Story = { args: { arrow: true } };

/**
 * 停用的元素:瀏覽器不讓 disabled 的元素發滑鼠事件,
 * 所以元件自動包一層 `span` 當事件載體 —— 呼叫端不必自己包。
 * 這正是組織管理動作列與模組與權限頁 self-lock 開關的情境。
 */
export const OnDisabledButton: Story = {
  args: {
    children: (
      <Button variant="text" disabled>
        停用
      </Button>
    ),
  },
};

export const OnDisabledSwitch: Story = {
  args: {
    title: "此模組用於管理模組本身,不可停用",
    children: (
      <Switch
        disabled
        defaultChecked
        slotProps={{ input: { "aria-label": "啟用" } }}
      />
    ),
  },
};

/** AppBar 的「?」:沒有對應說明檔時按鈕停用,提示說明原因。 */
export const OnDisabledIconButton: Story = {
  args: {
    title: "這個模組還沒有說明文件",
    children: (
      <IconButton aria-label="模組說明" size="small" disabled>
        <HelpIcon fontSize="small" />
      </IconButton>
    ),
  },
};

/** `title` 給空字串就不提示,呼叫端不必為了不提示而拆掉整個元素。 */
export const NoHint: Story = { args: { title: "" } };
