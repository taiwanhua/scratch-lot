import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import type { StoredValues } from "@repo/domain/form";
import {
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_FIELD_KEYS,
  STORE_KEY,
  type StocktakeDraft,
  parseStocktakeDraft,
  serializeStocktakeDraft,
} from "@repo/domain/project/lottery";
import { useLotteryStocktakeQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useMe } from "@/hooks/base/useMe";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { StocktakeWorkspace } from "./StocktakeWorkspace";

const orgSchema = z.string().default("");
const scopeSchema = z.string().default("");

/** 盤點確認申請的值(分店、範圍、彙總、說明、盤點內容)。 */
const valuesOf = (
  draft: StocktakeDraft,
  scopeLabel: string,
  totals: string,
  note: string,
): StoredValues => ({
  [STOCKTAKE_FIELD_KEYS.branch]: draft.orgId,
  [STOCKTAKE_FIELD_KEYS.scope]: scopeLabel,
  [STOCKTAKE_FIELD_KEYS.totals]: totals,
  [STOCKTAKE_FIELD_KEYS.note]: note.trim() === "" ? null : note.trim(),
  [STOCKTAKE_FIELD_KEYS.draft]: serializeStocktakeDraft(draft),
});

/** 送出後與 [取消(不保留)]:回店面管理(列表頁殼)或那張申請的檢視頁。 */
const useLeave = () => {
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const access = useFormModuleAccess(STORE_KEY);
  return {
    toList: () => {
      if (access.listRoute !== null) {
        void navigate(tabHref(access.listRoute));
      }
    },
    toView: (id: string) => {
      if (access.viewRoute !== null) {
        void navigate(`${access.viewRoute}/${id}`);
      }
    },
  };
};

/**
 * 臨時盤點(盤點確認申請的新增頁;規格 6.8、8.6;Figma ST-13 / 14 / 15):`?org=` 分店(預設目前組織)、
 * `?scope=` 單一收銀點(空 = 全店,ST-16 選)。盤點過程只在畫面上;[送出盤點確認申請] 以表單引擎建立並送出申請,
 * 盤點單由掛接點在同一個交易建立。
 */
export const StocktakeCreatePage = () => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const me = useMe();
  const [orgParam] = useUrlState("org", orgSchema);
  const [scope] = useUrlState("scope", scopeSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  const draftState = useFormDraft(STOCKTAKE_CONFIRM_FORM_KEY);
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const leave = useLeave();
  useRouteTabItemLabel(t("page.tabLabel"));
  if (orgId === "") {
    return null;
  }
  return (
    <Card
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        px: { xs: 1.5, sm: 3 },
        py: 2.5,
      }}
    >
      <StocktakeWorkspace
        orgId={orgId}
        scopeCashPointId={scope === "" ? null : scope}
        heading={t("types.adhoc")}
        initialDraft={null}
        submitError={
          draftState.error === null ? null : errorText(draftState.error)
        }
        isSubmitting={draftState.isPending}
        onCancel={leave.toList}
        onSubmit={async (draft, totals, note, scopeLabel) => {
          const submitted = await draftState.submit(
            valuesOf(draft, scopeLabel, totals, note),
            [],
          );
          if (submitted === null) {
            return false;
          }
          leave.toView(submitted.id);
          return true;
        }}
      />
    </Card>
  );
};

/**
 * 已退回的盤點確認申請:打開時帶入原內容,修改後再送出(規格 8.6;盤點確認申請的編輯頁)。
 */
export const StocktakeEditPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const id = routeParam ?? "";
  const submission = useFormSubmission(id);
  const detail = useLotteryStocktakeQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const leave = useLeave();
  useRouteTabItemLabel(submission.submission?.serialNo ?? t("page.tabLabel"));
  const stocktake = detail.data?.lotteryStocktake ?? null;
  if (detail.isError) {
    return <Alert severity="error">{t("view.loadFailed")}</Alert>;
  }
  if (stocktake === null || submission.submission === null) {
    return null;
  }
  const parsed = parseStocktakeDraft(stocktake.draft);
  return (
    <Card
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        px: { xs: 1.5, sm: 3 },
        py: 2.5,
      }}
    >
      <StocktakeWorkspace
        orgId={stocktake.orgId}
        scopeCashPointId={stocktake.scopeCashPoint?.id ?? null}
        heading={t("types.adhoc")}
        initialDraft={parsed.ok ? parsed.draft : null}
        notice={<Alert severity="info">{t("page.returnedHint")}</Alert>}
        submitError={
          submission.error === null ? null : errorText(submission.error)
        }
        isSubmitting={submission.isPending}
        onCancel={() => {
          leave.toView(id);
        }}
        onSubmit={async (draft, totals, note, scopeLabel) => {
          const done = await submission.submit(
            valuesOf(draft, scopeLabel, totals, note),
          );
          if (done === null) {
            return false;
          }
          leave.toView(id);
          return true;
        }}
      />
    </Card>
  );
};
