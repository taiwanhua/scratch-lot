import Box from "@mui/material/Box";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";

import { Button } from "../Button/Button";
import { Stack } from "../Stack/Stack";
import { PrinterTestPage, type PrinterTestPageProps } from "./PrinterTestPage";
import { printerTestPageLabels } from "./printer-test-page-fixture";
import { renderReceiptToPng } from "./render-receipt-to-png";

const meta = {
  title: "Components/Receipt58/PrinterTestPage",
  component: PrinterTestPage,
  parameters: { layout: "centered" },
  args: {
    tenantName: "示範商店",
    printerName: "櫃台收據機",
    printerHost: "192.0.2.50",
    time: "2026-10-15 10:30",
    managementUrl: "https://admin.example.test/system/printers",
    labels: printerTestPageLabels,
  },
} satisfies Meta<typeof PrinterTestPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `[測試列印]` 印的測試頁。 */
export const Default: Story = {};

/** 左邊預覽、右邊 `renderReceiptToPng` 的產出(與送到印表機的圖片相同),1:1 顯示。 */
const RenderedPngDemo = (props: PrinterTestPageProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const convert = async () => {
    if (receiptRef.current === null) return;
    const blob = await renderReceiptToPng(receiptRef.current);
    setPngUrl(URL.createObjectURL(blob));
  };
  return (
    <Stack direction="row" sx={{ alignItems: "flex-start" }}>
      <PrinterTestPage {...props} ref={receiptRef} />
      <Stack>
        <Button variant="contained" onClick={() => void convert()}>
          轉成 PNG
        </Button>
        {pngUrl === null ? null : (
          <Box
            component="img"
            src={pngUrl}
            alt="384 點黑白 PNG"
            sx={{ display: "block", imageRendering: "pixelated" }}
          />
        )}
      </Stack>
    </Stack>
  );
};

/** 預覽 → 轉成 384 點黑白 PNG(瀏覽器端);核對字體、條碼、QR code 轉圖後仍清楚。 */
export const RenderedPng: Story = {
  render: (args) => <RenderedPngDemo {...args} />,
};
