import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { Stack } from "../Stack/Stack";
import { TextField } from "../TextField/TextField";
import { Dialog } from "./Dialog";

const meta = {
  title: "Components/Dialog",
  component: Dialog,
  args: { open: true },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Draft/ConfirmDialog 57:712:破壞性操作,確認鈕用 error 色。 */
export const Confirm: Story = {
  args: {
    title: "刪除角色",
    children: "確定要刪除「客服」?將解除其所有授權,此動作無法復原。",
    maxWidth: "xs",
    fullWidth: true,
    actions: (
      <>
        <Button variant="text">取消</Button>
        <Button color="error">刪除</Button>
      </>
    ),
  },
};

/** Draft/HelpDialog 95:235:模組說明彈窗殼,只有一個關閉鈕。 */
export const Help: Story = {
  args: {
    title: "模組說明 — 角色管理",
    children:
      "建立與管理角色(權限的集合),把角色授予使用者。角色由單一組織擁有,只能授予該組織或其下層組織的使用者。",
    maxWidth: "sm",
    fullWidth: true,
    actions: <Button variant="text">關閉</Button>,
  },
};

/**
 * 標題 + 表單(開通租戶 88:146、編輯組織 88:167、新增使用者、選擇所屬組織都是這個形狀):
 * 第一個欄位的浮動標籤要完整看得到、不被標題壓住。
 */
export const TitleWithForm: Story = {
  args: {
    title: "開通租戶",
    children: (
      <Stack spacing={2.25}>
        <TextField label="租戶名稱" required fullWidth />
        <TextField label="首任管理員帳號" fullWidth />
      </Stack>
    ),
    maxWidth: "sm",
    fullWidth: true,
    actions: (
      <>
        <Button variant="text">取消</Button>
        <Button>送出</Button>
      </>
    ),
  },
};

/** 沒有 actions 時不渲染動作列。 */
export const TitleOnly: Story = {
  args: {
    title: "組織詳情",
    children: "這個彈窗沒有動作列。",
    maxWidth: "xs",
    fullWidth: true,
  },
};
