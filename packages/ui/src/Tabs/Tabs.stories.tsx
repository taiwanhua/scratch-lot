import type { Meta, StoryObj } from "@storybook/react-vite";

import { Tabs } from "./Tabs";

const meta = {
  title: "Components/Tabs",
  component: Tabs,
  args: {
    value: "matrix",
    items: [
      { value: "matrix", label: "權限設定" },
      { value: "users", label: "分配使用者" },
    ],
    "aria-label": "角色分頁",
    onChange: () => {
      // 受控元件:story 只看外觀,不真的換頁籤
    },
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma `Draft/Tabs` 252:14:選中的那格主色底線,整列下方一條分隔線。 */
export const Default: Story = {};

export const SecondSelected: Story = { args: { value: "users" } };

/** 切不過去的頁籤(權限不足、資料還沒到)。 */
export const WithDisabled: Story = {
  args: {
    items: [
      { value: "matrix", label: "權限設定" },
      { value: "users", label: "分配使用者", disabled: true },
    ],
  },
};

/** `value` 指到不存在的頁籤時整列都不選中(資料剛換掉的瞬間)。 */
export const NoneSelected: Story = { args: { value: "gone" } };

/**
 * Figma BS-15b `260:68369`:放不下時單列橫向捲動,還有頁籤的那一側顯示漸層 + ‹ / ›;
 * 選中的頁籤(`修訂紀錄`)一開始就捲進可視範圍。外框模擬窄卡片。
 */
export const Scrollable: Story = {
  args: {
    scrollable: true,
    value: "history",
    items: [
      { value: "basic", label: "基本資料" },
      { value: "contact", label: "聯絡資訊" },
      { value: "contract", label: "合約" },
      { value: "files", label: "附件" },
      { value: "review", label: "審核紀錄" },
      { value: "history", label: "修訂紀錄" },
      { value: "system", label: "系統資訊" },
    ],
    "aria-label": "客戶分頁",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
};
