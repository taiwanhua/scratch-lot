import { useTranslations } from "use-intl";

import { useLotteryWholesaleDetailQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { FormEditPage } from "@/components/base/form-engine/FormModulePages/FormEditPage";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { useDocumentEdit } from "../../shared/useDocumentEdit";
import { WholesaleForm } from "../WholesaleCreatePage/WholesaleForm";
import { wholesaleFormStateOf } from "../WholesaleCreatePage/wholesale-form";
import { WHOLESALE_MODULE_KEY } from "../wholesale-keys";

/**
 * 批售單的替換編輯頁(規格 21.3;草稿、被退回、撤回):和新增頁同一個畫面(`WholesaleForm`),帶入原內容。
 * 退回 / 撤回後本已解鎖,重新送出時重新檢查、重新鎖。能不能編輯、存草稿 / 送出沿用表單引擎(`useDocumentEdit`)。
 */
export const WholesaleEditPage = (props: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.wholesale.edit");
  const tErrors = useTranslations("admin.formEngine.errors");
  const { session } = useSession();
  const id = props.routeParam ?? "";
  const edit = useDocumentEdit(WHOLESALE_MODULE_KEY, id, {
    draftSaved: t("draftSaved"),
    submitted: t("submitted"),
  });
  const detail = useLotteryWholesaleDetailQuery(
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
  if (detail.isError) {
    return <Alert severity="error">{tEdit("loadFailed")}</Alert>;
  }
  const data = detail.data?.lotteryWholesaleDetail ?? null;
  if (state.kind === "loading" || data === null) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  const { submission } = state;
  return (
    <WholesaleForm
      key={submission.editVersion}
      mode="edit"
      title={
        submission.serialNo === null || submission.serialNo === undefined
          ? tEdit("title")
          : tEdit("titleWithNo", { serialNo: submission.serialNo })
      }
      initial={wholesaleFormStateOf(submission.values, data.rows)}
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
