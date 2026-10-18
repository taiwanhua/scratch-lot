import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreePicker } from "@/components/base/OrgTreePicker/OrgTreePicker";
import type { OrgNodeLike } from "@/lib/base/org-tree";

export interface OrgTreePanelProps {
  nodes: readonly OrgNodeLike[];
  isLoading: boolean;
  /** 沒有 `system.org-manager.view` 時樹不可用,改顯示說明(清單退成整個可見範圍) */
  isAvailable: boolean;
  selectedOrgId: string | null;
  onSelectOrg: (orgId: string | null) => void;
}

/**
 * 左欄組織樹(Figma OrgTree 91:263):選一個組織就把右側清單收斂到該組織子樹 ∩ 可見範圍。
 * 預設選中樹根:樹根的子樹就是整個可見範圍,所以「還沒挑」與「挑了最外圈」是同一件事。
 */
export const OrgTreePanel = ({
  nodes,
  isLoading,
  isAvailable,
  selectedOrgId,
  onSelectOrg,
}: OrgTreePanelProps) => {
  const t = useTranslations("admin.userManager.orgTree");

  return (
    <Card
      sx={{
        p: 2,
        width: 280,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        <Typography variant="subtitle1">{t("title")}</Typography>
        <Typography variant="caption" color="text.secondary">
          {isAvailable ? t("hint") : t("all")}
        </Typography>
        {isAvailable ? (
          // 樹佔滿標題以外的高度,超出時自己捲
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <OrgTreePicker
              nodes={nodes}
              isLoading={isLoading}
              selectedIds={selectedOrgId === null ? [] : [selectedOrgId]}
              onSelectedIdsChange={(ids) => {
                onSelectOrg(ids[0] ?? null);
              }}
              aria-label={t("title")}
            />
          </Box>
        ) : (
          <Alert severity="info">{t("unavailable")}</Alert>
        )}
      </Stack>
    </Card>
  );
};
