import CardContent from "@mui/material/CardContent";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Typography } from "../Typography/Typography";
import { Card } from "./Card";

const meta = {
  title: "Components/Card",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card sx={{ maxWidth: 360 }}>
      <CardContent>
        <Typography variant="h6">番茄炒蛋</Typography>
        <Typography variant="body2" color="textSecondary">
          十分鐘上桌的家常經典,滑嫩蛋香配上酸甜茄汁。
        </Typography>
      </CardContent>
    </Card>
  ),
};
