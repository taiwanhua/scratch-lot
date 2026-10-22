import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { List, ListItemButton } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { DataScopeTarget } from "./data-scope-types";

export interface TargetListPanelProps {
  targets: readonly DataScopeTarget[];
  isLoading: boolean;
  selectedTargetId: string | null;
  /** 有未儲存變更時由頁面攔下來先問(放棄變更確認),不是直接切 */
  onSelectTarget: (targetId: string) => void;
}

/**
 * 左欄資料目標清單(Figma TargetList 167:237):**一列 = 一個模組** —
 * 主文字是模組名、副文字是資料所在的 collection,再標有沒有規則。
 * 同一張表可以有好幾列(表單模組共用 `form_submissions`),各自一份規則。
 * 清單來自各模組 seed 宣告的 `dataScopeTarget`(ADR-0008),頁面不能新增或刪除。
 */
export const TargetListPanel = ({
  targets,
  isLoading,
  selectedTargetId,
  onSelectTarget,
}: TargetListPanelProps) => {
  const t = useTranslations("admin.dataScope.targets");

  return (
    <Card
      sx={{
        p: 2,
        // 手機寬(主從一次只顯示一邊)清單滿版
        width: { xs: "100%", sm: 320 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        <Typography variant="subtitle1">{t("title")}</Typography>
        <Typography variant="caption" color="textSecondary">
          {t("hint")}
        </Typography>
        {/* 清單佔滿標題以外的高度,超出時自己捲(STYLE-08) */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {isLoading && (
            <Stack sx={{ alignItems: "center", py: 4 }}>
              <CircularProgress aria-label={t("loading")} />
            </Stack>
          )}
          {!isLoading && targets.length === 0 && (
            <Typography variant="body2">{t("empty")}</Typography>
          )}
          <List aria-label={t("title")} disablePadding>
            {targets.map((target) => (
              <ListItemButton
                key={target.id}
                selected={target.id === selectedTargetId}
                sx={{ borderRadius: 1, mb: 0.5 }}
                onClick={() => {
                  onSelectTarget(target.id);
                }}
              >
                <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Typography variant="subtitle2">
                      {target.moduleName}
                    </Typography>
                    {/* 「已設規則」直接讀 api 的 hasRule */}
                    {target.hasRule && (
                      <Tag tone="primary" label={t("hasRule")} />
                    )}
                  </Stack>
                  <Typography variant="caption" color="textSecondary">
                    {target.collection}
                  </Typography>
                </Stack>
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Stack>
    </Card>
  );
};
