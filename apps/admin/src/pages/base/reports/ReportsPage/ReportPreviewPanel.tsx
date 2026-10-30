import type { ComponentType } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { SheetPreview } from "@/components/base/SheetPreview/SheetPreview";
import type { SheetData } from "@/lib/base/reports/excel";
import type { ReportSheetBodyProps } from "@/lib/base/reports/report-registry";

export interface ReportPreviewPanelProps {
  /** 「<報表名稱> · 2026-10-16」 */
  title: string;
  /** 選的組織名稱 */
  orgNames: readonly string[];
  /** 還沒查到(或查詢失敗,錯誤由頁面顯示)是 `null` */
  sheets: readonly SheetData[] | null;
  /** 報表自己的預覽畫法(不給 = 通用表格) */
  SheetBody?: ComponentType<ReportSheetBodyProps>;
  isLoading: boolean;
  sheetIndex: number;
  onSheetChange: (index: number) => void;
  canExport: boolean;
  isExporting: boolean;
  onExport: () => void;
  onBack: () => void;
}

/**
 * 預覽:標題列(報表 · 期間、組織)+ [匯出 Excel] [返回條件],
 * 下方是工作表預覽(預設全部組織合計,可切換組織)。
 */
export const ReportPreviewPanel = ({
  title,
  orgNames,
  sheets,
  SheetBody,
  isLoading,
  sheetIndex,
  onSheetChange,
  canExport,
  isExporting,
  onExport,
  onBack,
}: ReportPreviewPanelProps) => {
  const t = useTranslations("admin.reports");
  return (
    <Stack component="section" aria-label={title} spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { xs: "stretch", sm: "center" } }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            flex: 1,
            minWidth: 0,
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {orgNames.join("、")}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button variant="outlined" onClick={onBack}>
            {t("preview.back")}
          </Button>
          {canExport && (
            <Button
              variant="contained"
              disabled={isExporting}
              onClick={onExport}
            >
              {isExporting ? t("conditions.exporting") : t("conditions.export")}
            </Button>
          )}
        </Stack>
      </Stack>
      <Card sx={{ p: 2.5, minWidth: 0 }}>
        {isLoading && (
          <Stack sx={{ alignItems: "center", py: 4 }}>
            <CircularProgress aria-label={t("preview.loading")} />
          </Stack>
        )}
        {!isLoading && sheets !== null && (
          <SheetPreview
            sheets={sheets}
            value={sheetIndex}
            onChange={onSheetChange}
            Body={SheetBody}
          />
        )}
      </Card>
    </Stack>
  );
};
