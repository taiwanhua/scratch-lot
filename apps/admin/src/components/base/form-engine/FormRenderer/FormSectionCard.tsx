import type { ReactNode } from "react";

import { LAYOUT_COLUMNS, type LayoutSection } from "@repo/domain/form";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Grid } from "@repo/ui/grid";
import { Section } from "@repo/ui/section";
import { Typography } from "@repo/ui/typography";

import { SECTION_SPACING } from "./layout-grid";

export interface FormSectionCardProps {
  section: LayoutSection;
  /** 這個分區要畫的格子(`Grid` 項目) */
  cells: ReactNode;
  /** 可以收合(`sectionCollapseOf(section).collapsible`) */
  collapsible: boolean;
  /** 目前是否收合(記憶 + 送出有錯時的暫時展開,由 `FormRenderer` 算好) */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 收合時標題列顯示的欄位值(已排除看不到的欄位與空值) */
  summary?: string;
}

/**
 * 填寫 / 預覽 / 唯讀模式的一個分區(Spec 6a §8 畫面 9 / 11;底座 10.3):
 * 不可收合的(舊定義、沒勾「可以收合」)照舊是有框卡片 + 標題列;可以收合的改用 `@repo/ui/section`。
 */
export const FormSectionCard = ({
  section,
  cells,
  collapsible,
  collapsed,
  onCollapsedChange,
  summary,
}: FormSectionCardProps) => {
  const grid = (
    <Grid container columns={LAYOUT_COLUMNS} spacing={SECTION_SPACING}>
      {cells}
    </Grid>
  );

  if (collapsible) {
    return (
      <Section
        title={section.title}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        {...(summary !== undefined && summary !== "" && { summary })}
      >
        {grid}
      </Section>
    );
  }

  return (
    <Card component="section" variant="outlined" aria-label={section.title}>
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="subtitle1" component="h2">
          {section.title}
        </Typography>
      </Box>
      <Box sx={{ p: 2 }}>{grid}</Box>
    </Card>
  );
};
