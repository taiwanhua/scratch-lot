import type { Meta, StoryObj } from "@storybook/react-vite";

import { Receipt58 } from "./Receipt58";
import { Receipt58Barcode } from "./Receipt58Barcode";
import { Receipt58Cut } from "./Receipt58Cut";
import { Receipt58Divider } from "./Receipt58Divider";
import { Receipt58Header } from "./Receipt58Header";
import { Receipt58Qr } from "./Receipt58Qr";
import { Receipt58Range } from "./Receipt58Range";
import { Receipt58ReprintMark } from "./Receipt58ReprintMark";
import { Receipt58Row } from "./Receipt58Row";
import { Receipt58Signature } from "./Receipt58Signature";
import { Receipt58Table } from "./Receipt58Table";
import { Receipt58Text } from "./Receipt58Text";
import { Receipt58Total } from "./Receipt58Total";

/** 預覽時的紙張陰影(Figma Shadow/Card);只是畫面效果,不影響列印。 */
const paperSx = { boxShadow: 8 };

const reprint = {
  heading: "【補印】第 2 次",
  time: "2026-10-09 10:12",
  reason: "原因:破損",
  reprintedBy: "補印人:李大華",
};

const meta = {
  title: "Components/Receipt58",
  component: Receipt58,
  parameters: { layout: "centered" },
  args: { sx: paperSx, children: null },
} satisfies Meta<typeof Receipt58>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma `Draft/Receipt58`:用零件組成的示範(補印的收據),不是固定版面。 */
export const Demo: Story = {
  args: {
    children: (
      <>
        <Receipt58Header
          tenantName="示範商店"
          title="收據"
          documentNo="單號 C-0031"
          time="2026-10-13 15:02"
          reprint={reprint}
        />
        <Receipt58Divider />
        <Receipt58Row label="分店" value="示範分店 A" />
        <Receipt58Row label="櫃台" value="1 號櫃台" />
        <Receipt58Divider />
        <Receipt58Table
          head={["品項", "數量", "金額"]}
          rows={[
            ["A 商品", "12", "2,400"],
            ["B 商品", "5", "1,000"],
          ]}
        />
        <Receipt58Range
          label="序號:"
          numbers={[12, 13, 14, 15, 16, 20]}
          prefix="#"
          digits={3}
          formatCount={(count) => `(${String(count)} 筆)`}
        />
        <Receipt58Total label="合計" value="3,400" />
        <Receipt58Divider />
        <Receipt58Qr
          value="https://admin.example.test/documents/C-0031"
          caption="掃描開啟單據"
        />
        <Receipt58Signature signer="經手人簽名" />
        <Receipt58Signature signer="收件人簽名" />
      </>
    ),
  },
};

/** 表頭:租戶名稱、單據名稱、單號、時間。 */
export const Header: Story = {
  args: {
    children: (
      <Receipt58Header
        tenantName="示範商店"
        title="收據"
        documentNo="單號 C-0031"
        time="2026-10-13 15:02"
      />
    ),
  },
};

/** 表頭 + 補印標示。 */
export const HeaderReprint: Story = {
  args: {
    children: (
      <Receipt58Header
        tenantName="示範商店"
        title="收據"
        documentNo="單號 C-0031"
        time="2026-10-13 15:02"
        reprint={reprint}
      />
    ),
  },
};

/** 補印標示:「【補印】第 N 次 · 時間 · 原因 · 補印人」;原因為「其他」時印說明文字。 */
export const ReprintMark: Story = {
  args: {
    children: (
      <>
        <Receipt58ReprintMark {...reprint} />
        <Receipt58ReprintMark
          {...reprint}
          heading="【補印】第 3 次"
          reason="原因:客人要求另印一份給會計"
        />
      </>
    ),
  },
};

/** 標籤值列;值太長在右側換行。 */
export const Row: Story = {
  args: {
    children: (
      <>
        <Receipt58Row label="分店" value="示範分店 A" />
        <Receipt58Row
          label="備註"
          value="這是一段很長的備註,用來確認值會在右側自動換行"
        />
      </>
    ),
  },
};

/** 最多 3 欄的表格:表頭 + 內容列。 */
export const Table: Story = {
  args: {
    children: (
      <Receipt58Table
        head={["品項", "數量", "金額"]}
        rows={[
          ["A 商品", "12", "2,400"],
          ["名稱很長的 B 商品(大包裝)", "5", "1,000"],
        ]}
      />
    ),
  },
};

/** 號碼區段。 */
export const Range: Story = {
  args: {
    children: (
      <Receipt58Range
        label="序號:"
        numbers={[12, 13, 14, 15, 16, 20, 31, 32, 40]}
        prefix="#"
        digits={3}
        formatCount={(count) => `(${String(count)} 筆)`}
      />
    ),
  },
};

/** 分隔線。 */
export const Divider: Story = {
  args: {
    children: (
      <>
        <Receipt58Text>上一區</Receipt58Text>
        <Receipt58Divider />
        <Receipt58Text>下一區</Receipt58Text>
      </>
    ),
  },
};

/** 合計列。 */
export const Total: Story = {
  args: { children: <Receipt58Total label="合計" value="3,400" /> },
};

/** 簽名欄。 */
export const Signature: Story = {
  args: { children: <Receipt58Signature signer="經手人簽名" /> },
};

/** QR code:內容 = 單據在後台的連結。 */
export const Qr: Story = {
  args: {
    children: (
      <Receipt58Qr
        value="https://admin.example.test/documents/C-0031"
        caption="掃描開啟單據"
      />
    ),
  },
};

/** 文字列:大 / 一般 / 小 / 粗體 × 靠左 / 置中 / 靠右,太長自動換行。 */
export const Text: Story = {
  args: {
    children: (
      <>
        <Receipt58Text variant="large">大字 ABC 123</Receipt58Text>
        <Receipt58Text variant="normal">一般字 ABC 123</Receipt58Text>
        <Receipt58Text variant="small">小字 ABC 123</Receipt58Text>
        <Receipt58Text variant="bold">粗體字 ABC 123</Receipt58Text>
        <Receipt58Text align="left">靠左</Receipt58Text>
        <Receipt58Text align="center">置中</Receipt58Text>
        <Receipt58Text align="right">靠右</Receipt58Text>
        <Receipt58Text>
          一行約十六個中文字這是第十七個字會換到下一行,不會被截斷。
        </Receipt58Text>
      </>
    ),
  },
};

/** 一維條碼(Code128)。 */
export const Barcode: Story = {
  args: { children: <Receipt58Barcode value="D0031202610150001" /> },
};

/** 切紙位置。 */
export const Cut: Story = {
  args: { children: <Receipt58Cut label="切紙" /> },
};
