import { useTranslations } from "use-intl";

import { useLotteryTransferReceivingQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { FormEditPage } from "@/components/base/form-engine/FormModulePages/FormEditPage";
import type { BookRowStatus } from "@/components/project/lottery/BookGroupList/BookGroupList";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { useDocumentEdit } from "../../shared/useDocumentEdit";
import { TransferForm } from "../TransferCreatePage/TransferForm";
import { transferFormStateOf } from "../TransferCreatePage/transfer-form";
import { TRANSFER_MODULE_KEY } from "../transfer-keys";

/**
 * 調貨單的替換編輯頁(專案規格 8.4;草稿、被退回、撤回):和新增頁同一個畫面(`TransferForm`),帶入原內容。
 * 被退回時,已出貨(在途)/ 已點收的列鎖住並標示(規格 8.4「退回 / 撤回後:已在途的保持在途」;api 也擋改已出貨 /
 * 已點收的列),沒出貨的列可改可刪、可再加新的本。能不能編輯、存草稿 / 送出沿用表單引擎(`useDocumentEdit`)。
 */
export const TransferEditPage = (props: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.transfer.edit");
  const tErrors = useTranslations("admin.formEngine.errors");
  const { session } = useSession();
  const id = props.routeParam ?? "";
  const edit = useDocumentEdit(TRANSFER_MODULE_KEY, id, {
    draftSaved: t("draftSaved"),
    submitted: t("submitted"),
  });
  const receiving = useLotteryTransferReceivingQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  const { state } = edit;
  useRouteTabItemLabel(
    state.kind === "ready" ? state.submission.serialNo : null,
  );

  if (state.kind === "engine") {
    return <FormEditPage {...props} />;
  }
  if (state.kind === "unavailable") {
    return <Alert severity="error">{tErrors(state.code)}</Alert>;
  }
  if (receiving.isError) {
    return <Alert severity="error">{tEdit("loadFailed")}</Alert>;
  }
  const data = receiving.data?.lotteryTransferReceiving ?? null;
  if (state.kind === "loading" || data === null) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  const lockedRows = new Map<string, BookRowStatus>(
    data.rows.flatMap((row): [string, BookRowStatus][] => {
      if (row.received) {
        return [[row.rowId, "received"]];
      }
      return row.shipped ? [[row.rowId, "inTransit"]] : [];
    }),
  );
  const { submission } = state;

  return (
    <TransferForm
      key={submission.editVersion}
      mode="edit"
      submissionId={submission.id}
      title={
        submission.serialNo === null || submission.serialNo === undefined
          ? tEdit("title")
          : tEdit("titleWithNo", { serialNo: submission.serialNo })
      }
      initial={transferFormStateOf(submission.values, data.rows)}
      lockedRows={lockedRows}
      notice={edit.notice}
      canSaveDraft={edit.canSaveDraft}
      isPending={edit.isPending}
      error={edit.error}
      onSaveDraft={edit.saveDraft}
      onSubmit={edit.submit}
      onCancel={edit.leave}
    />
  );
};
