import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChevronDoubleLeftIcon } from "../icons/ChevronDoubleLeftIcon";
import { CloseIcon } from "../icons/CloseIcon";
import { EditIcon } from "../icons/EditIcon";
import { HelpIcon } from "../icons/HelpIcon";
import { IconButton } from "./IconButton";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  args: {
    "aria-label": "關閉",
    children: <CloseIcon fontSize="small" />,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 路由頁籤的關閉鈕。 */
export const Default: Story = {};

export const Small: Story = { args: { size: "small" } };

/** AppBar 的「?」說明鈕:呼叫端用 `sx` 指定平時的顏色。 */
export const Secondary: Story = {
  args: {
    "aria-label": "模組說明",
    children: <HelpIcon fontSize="small" />,
    sx: { color: "text.secondary" },
  },
};

/**
 * 停用:即使呼叫端給了 `sx.color`,停用色照樣蓋得過去 ——
 * `.Mui-disabled` 的 specificity 比 `sx` 產生的單一類別高一級。
 */
export const Disabled: Story = {
  args: {
    "aria-label": "模組說明",
    children: <HelpIcon fontSize="small" />,
    sx: { color: "text.secondary" },
    disabled: true,
  },
};

/**
 * 外框變體:側欄底部的收合開關(Figma collapse-toggle 246:97,40×40)。
 * 外框與邊長由元件自己給,呼叫端不再用 `sx` 畫框(STYLE-10 的例外因此退場)。
 */
export const Outlined: Story = {
  args: {
    "aria-label": "收合側欄",
    variant: "outlined",
    children: <ChevronDoubleLeftIcon fontSize="small" />,
  },
};

/** 外框變體的 small(32×32):放在列表的列操作那種密度較高的地方。 */
export const OutlinedSmall: Story = {
  args: {
    "aria-label": "編輯",
    variant: "outlined",
    size: "small",
    children: <EditIcon fontSize="small" />,
  },
};
