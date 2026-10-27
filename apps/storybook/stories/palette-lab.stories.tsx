import Box from "@mui/material/Box";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import { ThemeProvider } from "@mui/material/styles";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { projectPublic } from "@repo/project-config/public";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { TextField } from "@repo/ui/text-field";
import { createAppTheme, createBrandFromPrimary } from "@repo/ui/theme";
import { Typography } from "@repo/ui/typography";

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;
/** 起始色 = 專案目前的主色(與 preview.tsx 整個目錄用的同一份),從它開始調 */
const DEFAULT_HEX = projectPublic.brand.primary;

/**
 * Palette Lab:貼上一個主色,立即預覽所有元件換裝後的效果。
 * 為新品牌挑色的流程:調色 → 逛一圈 → 滿意再把主色填進專案設定正本
 * `packages/project-config/src/project/public.ts` 的 `projectPublic.brand.primary`(登記於 docs/branding.md)。
 */
function PaletteLab() {
  const [hex, setHex] = useState(DEFAULT_HEX);
  const effectiveHex = HEX_PATTERN.test(hex) ? hex : DEFAULT_HEX;
  const brand = createBrandFromPrimary("Preview", effectiveHex);
  const theme = createAppTheme(brand, { cssVarPrefix: "lab" });

  const scale = [
    ["lighter", brand.primary.lighter],
    ["light", brand.primary.light],
    ["main", brand.primary.main],
    ["dark", brand.primary.dark],
    ["darker", brand.primary.darker],
  ] as const;

  return (
    <ThemeProvider theme={theme}>
      <Stack spacing={4} sx={{ p: 3, maxWidth: 720 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <input
            aria-label="挑選主色"
            type="color"
            value={effectiveHex}
            onChange={(event) => {
              setHex(event.target.value.toUpperCase());
            }}
            style={{ width: 48, height: 48, border: "none", padding: 0 }}
          />
          <TextField
            size="small"
            label="主色 HEX"
            value={hex}
            error={!HEX_PATTERN.test(hex)}
            onChange={(event) => {
              setHex(event.target.value);
            }}
          />
          <Stack direction="row" spacing={1}>
            {scale.map(([label, color]) => (
              <Stack key={label} sx={{ alignItems: "center" }} spacing={0.5}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    bgcolor: color,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                />
                <Typography variant="caption" color="textSecondary">
                  {label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>

        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Button>主要按鈕</Button>
          <Button variant="outlined">外框按鈕</Button>
          <Button variant="text">文字按鈕</Button>
          <Button disabled>停用</Button>
        </Stack>

        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <TextField label="食譜名稱" helperText="輸入框示範" />
          <Chip label="家常菜" color="primary" />
          <Switch defaultChecked />
          <Box sx={{ width: 160 }}>
            <Slider defaultValue={60} />
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ mr: 1 }}>
            狀態色
          </Typography>
          <Chip label="資訊" color="info" />
          <Chip label="成功" color="success" />
          <Chip label="警告" color="warning" />
          <Chip label="錯誤" color="error" />
        </Stack>

        <Stack direction="row" spacing={3} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2">陰影</Typography>
          {(
            [
              ["z1", theme.customShadows.z1],
              ["z8", theme.customShadows.z8],
              ["z24", theme.customShadows.z24],
              ["primary", theme.customShadows.primary],
            ] as const
          ).map(([label, shadow]) => (
            <Stack key={label} spacing={0.5} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: 1.5,
                  bgcolor: "background.paper",
                  boxShadow: shadow,
                }}
              />
              <Typography variant="caption" color="textSecondary">
                {label}
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Card sx={{ maxWidth: 360 }}>
          <CardContent>
            <Typography variant="h6">番茄炒蛋</Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              十分鐘上桌的家常經典,滑嫩蛋香配上酸甜茄汁。
            </Typography>
            <Button size="small">查看食譜</Button>
          </CardContent>
        </Card>
      </Stack>
    </ThemeProvider>
  );
}

const meta = {
  title: "Design/Palette Lab",
  component: PaletteLab,
} satisfies Meta<typeof PaletteLab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
