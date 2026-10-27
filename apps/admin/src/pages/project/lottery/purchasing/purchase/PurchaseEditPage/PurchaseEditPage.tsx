import { useTranslations } from "use-intl";

import { useLotteryPurchaseReceivingQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { FormEditPage } from "@/components/base/form-engine/FormModulePages/FormEditPage";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { useDocumentEdit } from "../../shared/useDocumentEdit";
import { PurchaseForm } from "../PurchaseCreatePage/PurchaseForm";
import {
  type PurchaseGame,
  purchaseFormStateOf,
} from "../PurchaseCreatePage/purchase-form";
import { PURCHASE_MODULE_KEY } from "../purchase-keys";

/**
 * 進貨單的替換編輯頁(專案規格 8.2;草稿、被退回、撤回):和新增頁同一個畫面(`PurchaseForm`),帶入原內容。
 * 被退回時(規格 8.2「打錯 → 退回修改沒點收的列」):已點收的列鎖住、標「已點收」,沒點收的列可改可刪、可再刷新的本;
 * 點收在這裡不能操作(點收要單據在審核中)。能不能編輯、存草稿 / 送出沿用表單引擎(`useDocumentEdit`)。
 */
export const PurchaseEditPage = (props: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.purchase.edit");
  const tErrors = useTranslations("admin.formEngine.errors");
  const { session } = useSession();
  const id = props.routeParam ?? "";
  const edit = useDocumentEdit(PURCHASE_MODULE_KEY, id, {
    draftSaved: t("draftSaved"),
    submitted: t("submitted"),
  });
  const receiving = useLotteryPurchaseReceivingQuery(
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
  const data = receiving.data?.lotteryPurchaseReceiving ?? null;
  if (state.kind === "loading" || data === null) {
    return <CircularProgress aria-label={t("loading")} />;
  }

  const groups = data.groups;
  const locked = new Set(
    groups.flatMap((group) =>
      group.rows.filter((row) => row.received).map((row) => row.rowId),
    ),
  );
  // 鎖住的列的遊戲(停售後不在新增頁的遊戲清單裡):用點收區塊讀到的事實補
  const extraGames: PurchaseGame[] = groups.flatMap((group) => {
    const first = group.rows.at(0);
    return first === undefined
      ? []
      : [
          {
            id: group.gameId,
            gameCode: group.gameCode,
            name: group.gameName,
            unitPrice: group.unitPrice,
            ticketsPerBook: first.tickets,
            bookPrice: first.bookPrice,
            defaultRate: first.rate,
          },
        ];
  });
  const { submission } = state;

  return (
    <PurchaseForm
      key={submission.editVersion}
      mode="edit"
      submissionId={submission.id}
      title={
        submission.serialNo === null || submission.serialNo === undefined
          ? tEdit("title")
          : tEdit("titleWithNo", { serialNo: submission.serialNo })
      }
      initial={purchaseFormStateOf(submission.values)}
      lockedRowIds={locked}
      extraGames={extraGames}
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
