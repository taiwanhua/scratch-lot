import type { Meta, StoryObj } from "@storybook/react-vite";

import { Box } from "../Box/Box";
import { Typography } from "../Typography/Typography";
import { NavDrawer } from "./NavDrawer";

const meta = {
  title: "Components/NavDrawer",
  component: NavDrawer,
  args: {
    open: true,
    onClose: () => {
      // story 只看外觀:開關由呼叫端接手
    },
    children: (
      <Box sx={{ width: 240, p: 2 }}>
        <Typography variant="h6">主選單</Typography>
      </Box>
    ),
  },
} satisfies Meta<typeof NavDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 手機寬的側欄抽屜:從左側滑出、蓋在畫面上。 */
export const Default: Story = {};
