import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormSubmissionDetail } from "@/components/base/form-engine/FormSubmissionDetail/FormSubmissionDetail";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";

import { branchLabelOf } from "./support-requests";

export interface SupportRequestPanelProps {
  /** 選中的那一筆;null = 還沒選 */
  id: string | null;
  /** 詳情頁的路由(開完整頁面);沒綁詳情頁 = null */
  viewRoute: string | null;
}

/**
 * 列表右側的檢視 / 審核(Figma SC-31 274:32718):表單引擎的唯讀詳情 + 審核區塊
 * (核准 / 退回 / 駁回由底座 `ApprovalSection` 依「我的任務」顯示)。
 */
export const SupportRequestPanel = ({
  id,
  viewRoute,
}: SupportRequestPanelProps) => {
  const t = useTranslations("admin.schedule.supportRequests");
  const navigate = useNavigate();

  return (
    <Card
      variant="outlined"
      component="section"
      aria-label={t("panelAria")}
      sx={{
        width: 420,
        flexShrink: 0,
        minHeight: 0,
        overflow: "auto",
        p: 2.5,
      }}
    >
      {id === null ? (
        <Typography variant="body2" color="textSecondary">
          {t("selectHint")}
        </Typography>
      ) : (
        <SelectedRequest
          key={id}
          id={id}
          viewRoute={viewRoute}
          onOpen={(path) => void navigate(path)}
        />
      )}
    </Card>
  );
};

interface SelectedRequestProps {
  id: string;
  viewRoute: string | null;
  onOpen: (path: string) => void;
}

const SelectedRequest = ({ id, viewRoute, onOpen }: SelectedRequestProps) => {
  const t = useTranslations("admin.schedule.supportRequests");
  const { submission } = useFormSubmission(id);
  const instanceId = submission?.currentInstanceId ?? null;
  // Figma SC-31:「S-0012 · 中山店」;還沒有單號(舊資料)時退回「支援需求單 · 分店」
  const panelTitleOf = (row: NonNullable<typeof submission>): string => {
    const branch = branchLabelOf(row);
    return row.serialNo === null || row.serialNo === undefined
      ? t("panelTitle", { branch })
      : t("panelTitleWithSerial", { serial: row.serialNo, branch });
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
          {submission === null
            ? t("panelTitleLoading")
            : panelTitleOf(submission)}
        </Typography>
        {viewRoute !== null && (
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onOpen(`${viewRoute}/${id}`);
            }}
          >
            {t("openPage")}
          </Button>
        )}
      </Stack>
      <FormSubmissionDetail id={id} />
      {instanceId !== null && (
        <ApprovalSection instanceId={instanceId} submission={submission} />
      )}
    </Stack>
  );
};
