import { useTranslations } from "use-intl";

import {
  REQUISITION_FIELD_KEYS,
  referenceIdOf,
} from "@repo/domain/project/lottery";
import { useLotteryRequisitionCandidatesQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { FormEditPage } from "@/components/base/form-engine/FormModulePages/FormEditPage";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { RequisitionForm } from "../RequisitionCreatePage/RequisitionForm";
import { requisitionFormStateOf } from "../RequisitionCreatePage/requisition-form";
import { REQUISITION_MODULE_KEY } from "../purchasing-keys";
import { useDocumentEdit } from "../shared/useDocumentEdit";

/**
 * 叫貨單的替換編輯頁(規格 8.1;草稿、被退回、撤回):和新增頁同一個畫面(`RequisitionForm`),帶入原內容
 * (叫貨分店、期望到貨日、每個遊戲叫幾本;rowId、明細備註、單頭備註照舊)。先讀那家店的販售中遊戲,
 * 不在裡面的列原樣保留並提示。能不能編輯、存草稿 / 送出沿用表單引擎(`useDocumentEdit`)。
 */
export const RequisitionEditPage = (props: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.edit");
  const tErrors = useTranslations("admin.formEngine.errors");
  const { session } = useSession();
  const id = props.routeParam ?? "";
  const edit = useDocumentEdit(REQUISITION_MODULE_KEY, id, {
    draftSaved: t("draftSaved"),
    submitted: t("submitted"),
  });
  const { state } = edit;
  const branchId =
    state.kind === "ready"
      ? (referenceIdOf(
          state.submission.values[REQUISITION_FIELD_KEYS.branch],
        ) ?? "")
      : "";
  const candidates = useLotteryRequisitionCandidatesQuery(
    session.client,
    { orgId: branchId },
    { enabled: branchId !== "" },
  );
  useRouteTabItemLabel(
    state.kind === "ready" ? state.submission.serialNo : null,
  );

  if (state.kind === "engine") {
    return <FormEditPage {...props} />;
  }
  if (state.kind === "unavailable") {
    return <Alert severity="error">{tErrors(state.code)}</Alert>;
  }
  if (candidates.isError) {
    return <Alert severity="error">{tEdit("loadFailed")}</Alert>;
  }
  if (
    state.kind === "loading" ||
    (branchId !== "" && candidates.data === undefined)
  ) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  const { submission } = state;
  const onSale = new Set(
    (candidates.data?.lotteryRequisitionCandidates ?? []).map(
      (row) => row.gameId,
    ),
  );

  return (
    <RequisitionForm
      key={submission.editVersion}
      title={
        submission.serialNo === null || submission.serialNo === undefined
          ? tEdit("title")
          : tEdit("titleWithNo", { serialNo: submission.serialNo })
      }
      initial={requisitionFormStateOf(submission.values, onSale)}
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
