import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { TextField } from "../TextField/TextField";
import { Drawer } from "./Drawer";

const meta = {
  title: "Components/Drawer",
  component: Drawer,
  args: {
    open: true,
    title: "篩選",
    closeLabel: "關閉",
    onClose: () => {
      // story 只看外觀:開關由呼叫端接手
    },
    children: <TextField label="狀態" fullWidth />,
    actions: (
      <>
        <Button variant="outlined">清除</Button>
        <Button>套用</Button>
      </>
    ),
  },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** RW-01b 平板 224:1855:從右側滑出。 */
export const Right: Story = { args: { anchor: "right" } };

/** RW-01b 手機 224:1952:從底部升起,上方有拉把。 */
export const Bottom: Story = { args: { anchor: "bottom" } };
