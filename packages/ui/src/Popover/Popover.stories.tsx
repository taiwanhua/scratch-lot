import Box from "@mui/material/Box";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Typography } from "../Typography/Typography";
import { Popover } from "./Popover";

const meta = {
  title: "Components/Popover",
  component: Popover,
  args: {
    open: true,
    anchorReference: "anchorPosition" as const,
    anchorPosition: { top: 120, left: 120 },
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Draft/Popover 73:3 的版型:寬 240、左右 14 上下 12、項目間距 8。 */
export const Default: Story = {
  args: {
    children: (
      <Box
        sx={{
          width: 240,
          paddingInline: 1.75,
          paddingBlock: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ fontWeight: 600 }}
        >
          標題
        </Typography>
        <Typography variant="body2">項目 1</Typography>
        <Typography variant="body2">項目 2</Typography>
      </Box>
    ),
  },
};
