import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { DataTable } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";

import { CONFLICT_ROLE_LABELS } from "./dealer-labels";
import type { ConflictRelationship } from "./dealers-error";

export interface ConflictDialogProps {
  title: string;
  message: string;
  /** 列出的關聯;`column` 決定第二欄顯示關係人還是經銷商 */
  relationships: readonly ConflictRelationship[];
  column: "contact" | "dealer";
  confirmLabel: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 擋下並列出關聯、詢問後自動解除(規格 5.2「移除共同銷售處所但還有代理人」、5.3「要取消的身分還有關聯」;
 * Figma DE-06b)。確認 = 一併解除並儲存(api 帶 `releaseAgents` / `releaseRelationships` 重送)。
 */
export const ConflictDialog = ({
  title,
  message,
  relationships,
  column,
  confirmLabel,
  isSubmitting,
  onCancel,
  onConfirm,
}: ConflictDialogProps) => {
  const t = useTranslations("admin.lotteryDealers");
  return (
    <Dialog
      open
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("actions.cancel")}
          </Button>
          <Button color="error" disabled={isSubmitting} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Alert severity="warning">{message}</Alert>
        <DataTable
          size="small"
          aria-label={title}
          getRowKey={(item) =>
            `${item.dealerId}-${item.contactId}-${item.role}`
          }
          rows={relationships}
          columns={[
            {
              key: "role",
              header: t("conflict.relation"),
              width: 120,
              accessor: (item) => t(CONFLICT_ROLE_LABELS[item.role] ?? ""),
            },
            {
              key: "name",
              header:
                column === "contact"
                  ? t("conflict.contact")
                  : t("conflict.dealer"),
              width: 220,
              accessor: (item) =>
                column === "contact"
                  ? item.contactName
                  : `${item.dealerName} #${item.licenseNo}`,
            },
          ]}
        />
      </Stack>
    </Dialog>
  );
};
