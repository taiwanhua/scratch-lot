import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { useTenantOrgTreeQuery } from "@repo/graphql";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { flattenOrgs, tenantTreeToOrgNodes } from "@/lib/base/org-tree";
import { type SheetData, downloadWorkbook } from "@/lib/base/reports/excel";
import {
  REPORTS_PERMISSIONS,
  type ReportDefinition,
  type ReportOrg,
  type ReportQueryInput,
  reportSheetsOf,
} from "@/lib/base/reports/report-registry";

import { type ReportsErrorCode, reportsErrorOf } from "./reports-error";

export interface ReportRunOptions {
  report: ReportDefinition;
  /** 查詢 input;`null` = 條件不完整(沒選組織),不能查 */
  input: ReportQueryInput | null;
  /** 預覽開著才查 */
  isPreviewOpen: boolean;
  timezone: string;
  /** 報表名稱 + 期間的顯示文字(檔名用) */
  fileLabel: { name: string; period: string };
}

export interface ReportRun {
  /** 選的組織(含名稱,順序照選擇器) */
  orgs: ReportOrg[];
  /** 預覽的工作表(合計在前);還沒查到是 `null` */
  sheets: SheetData[] | null;
  isLoading: boolean;
  /** 預覽或匯出失敗的錯誤碼 */
  errorCode: ReportsErrorCode | null;
  isExporting: boolean;
  exportExcel: () => Promise<void>;
  /** 清掉匯出失敗的錯誤(改條件、關預覽時;預覽查詢的錯誤跟著條件走,不必清) */
  clearExportError: () => void;
}

/**
 * 跑一張報表:預覽用 TanStack Query 查(key / fetcher 都取報表登記的 codegen 查詢,DATA-01 / DATA-02),
 * 匯出時 `fetchQuery` 同一個 key → 工作表 → Excel 下載:從預覽按的匯出直接用預覽那份快取
 * (`staleTime: Infinity`,Excel 就是畫面上那一份、不重打 api);預覽沒開(從條件區按)時 `staleTime: 0`,每次重查。
 * 預覽與 Excel 用同一個 `sheets` 函式,看到的就是匯出的內容。
 */
export const useReportRun = ({
  report,
  input,
  isPreviewOpen,
  timezone,
  fileLabel,
}: ReportRunOptions): ReportRun => {
  const t = useTranslations("admin");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const me = useMe();
  // 組織名稱:與組織選擇器同一份(可見範圍,`scope="visible"`)
  const orgTree = useTenantOrgTreeQuery(session.client);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  const orgIds = input?.orgIds;
  const orgs = useMemo(() => {
    const nameOf = new Map(
      flattenOrgs(
        tenantTreeToOrgNodes(orgTree.data?.tenantOrgTree ?? [], false),
      ).map((org) => [org.id, org.name]),
    );
    return (orgIds ?? []).map((id) => ({ id, name: nameOf.get(id) ?? id }));
  }, [orgTree.data, orgIds]);

  const variables = input === null ? null : { input };
  const queryOptions =
    variables === null
      ? null
      : {
          queryKey: report.query.getKey(variables),
          queryFn: report.query.fetcher(session.client, variables),
        };
  const query = useQuery({
    queryKey: queryOptions?.queryKey ?? ["ReportIdle", report.key],
    queryFn: queryOptions?.queryFn ?? (() => Promise.resolve(null)),
    enabled: isPreviewOpen && queryOptions !== null,
  });

  const toSheets = (data: unknown, generatedAt: Date): SheetData[] | null =>
    input === null
      ? null
      : reportSheetsOf(
          report.sheets(data, {
            t: (key, values) => t(key, values),
            timezone,
            input,
            orgs,
            canShowCost: hasPermission(REPORTS_PERMISSIONS.showCost),
            generatedAt,
            generatedBy: me.data?.me.name ?? "",
          }),
          orgs,
          t("reports.totalSheet"),
        );

  const sheets =
    query.data === undefined || query.data === null
      ? null
      : toSheets(query.data, new Date(query.dataUpdatedAt));

  const exportExcel = async () => {
    if (queryOptions === null) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const data = await queryClient.fetchQuery({
        ...queryOptions,
        // 預覽開著 = 匯出畫面上那一份(同一個 key 已查過);沒開就重查
        staleTime: isPreviewOpen ? Number.POSITIVE_INFINITY : 0,
      });
      const exported = toSheets(data, new Date());
      if (exported !== null) {
        await downloadWorkbook({
          sheets: exported,
          fileName: t("reports.fileName", fileLabel),
        });
      }
    } catch (error) {
      setExportError(error);
    } finally {
      setIsExporting(false);
    }
  };

  const failure = exportError ?? (isPreviewOpen ? query.error : null);
  return {
    orgs,
    sheets,
    isLoading: isPreviewOpen && query.isFetching,
    errorCode: failure === null ? null : reportsErrorOf(failure).code,
    isExporting,
    exportExcel,
    clearExportError: () => {
      setExportError(null);
    },
  };
};
