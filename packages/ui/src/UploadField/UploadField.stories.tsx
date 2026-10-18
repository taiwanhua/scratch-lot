import type { Meta, StoryObj } from "@storybook/react-vite";

import { UploadField } from "./UploadField";

const meta = {
  title: "Components/UploadField",
  component: UploadField,
  args: {
    label: "商標(選填)",
    hint: "PNG / JPG,建議正方形,2MB 以內",
    accept: ["image/png", "image/jpeg"],
    maxSize: 2 * 1024 * 1024,
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof UploadField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 空狀態:點擊或拖放選檔 */
export const Empty: Story = {};

export const WithoutHint: Story = { args: { hint: undefined } };

export const Disabled: Story = { args: { isDisabled: true } };

/** 編輯情境:一開啟就顯示既有的圖片,選新檔會取代它、按移除回到空狀態 */
export const WithInitialPreview: Story = {
  args: {
    initialPreviewUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%23f97316'/></svg>",
  },
};

/** 只收 PDF,示範 accept 換成別的型別 */
export const PdfOnly: Story = {
  args: {
    label: "附件",
    hint: "PDF,10MB 以內",
    accept: [".pdf"],
    maxSize: 10 * 1024 * 1024,
  },
};
