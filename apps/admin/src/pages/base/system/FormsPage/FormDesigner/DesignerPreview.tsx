import { useState } from "react";
import { useTranslations } from "use-intl";

import type { FormDefinition, StoredValues } from "@repo/domain/form";
import {
  type PreviewFormVersionQuery,
  usePreviewFormVersionQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormRenderer } from "@/components/base/form-engine/FormRenderer/FormRenderer";
import { LookupDialog } from "@/components/base/form-engine/LookupDialog/LookupDialog";
import { useFillValues } from "@/hooks/base/useFillValues";
import { useLiveIdentity } from "@/hooks/base/useLiveIdentity";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { liveContextOf } from "@/lib/base/form-engine/expression-context";
import { OPEN_PERMISSIONS } from "@/lib/base/form-engine/field-states";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";
import { summaryDateTypeOf } from "@/lib/base/form-engine/tab-label";

export interface DesignerPreviewProps {
  formKey: string;
  definition: FormDefinition;
  /** 草稿有未存的變更:後端預覽算的是已存的那一份 */
  isDirty: boolean;
  /** 唯讀檢視已發布 / 已退役的版本時是它的版號(「以後端重算」算那一版);草稿為 null */
  version?: number | null;
}

type PreviewResult = PreviewFormVersionQuery["previewFormVersion"];

/**
 * 預覽模式:`FormRenderer` 的 `preview` 模式 —— 條件與計算前端即時跑、
 * 不套欄位級權限、輸入測試值、不建提交;「以後端重算」打 `previewFormVersion` 對**已存的草稿**
 * (唯讀檢視歷史版本時是**那一版**,帶 `version`)算一次(以後端為準:摘要槽、值錯誤)。
 * 預設值與填寫頁同一套:一打開就填好,沒碰過的欄位跟著依賴重算。
 */
export const DesignerPreview = ({
  formKey,
  definition,
  isDirty,
  version = null,
}: DesignerPreviewProps) => {
  const t = useTranslations("admin.forms.preview");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const me = useMe();
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [now] = useState(() => new Date());
  const user = me.data?.me;
  const timezone = useTenantTimezone();
  const temporalText = useTemporalText();
  // 摘要槽「日期」對到日期欄印日期,對日期時間欄或沒對(= 送出時間)印到分鐘
  const summaryDateType = summaryDateTypeOf(definition);
  const identity = useLiveIdentity();
  const expressionContext = liveContextOf(identity, now, timezone);
  const fill = useFillValues({
    fields: definition.fields,
    initialValues: {},
    ctx: expressionContext,
    permissions: OPEN_PERMISSIONS,
    recomputeDefaults: true,
    fillOnMount: true,
    systemLabels: {
      user: user?.name ?? null,
      org: user?.currentOrg?.name ?? null,
    },
  });
  const values: StoredValues = fill.values;

  const runOnServer = async () => {
    setIsRunning(true);
    setFailure(null);
    try {
      const payload = await usePreviewFormVersionQuery.fetcher(session.client, {
        input: { formKey, values, ...(version !== null && { version }) },
      })();
      setResult(payload.previewFormVersion);
    } catch (error_) {
      setFailure(tErrors(formErrorOf(error_).code));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Stack spacing={2} component="section" aria-label={t("region")}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {isDirty ? t("dirtyHint") : t("hint")}
        </Typography>
        {definition.prefills.length > 0 && (
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              setIsPrefilling(true);
            }}
          >
            {t("prefill")}
          </Button>
        )}
        <Button
          size="small"
          disabled={isRunning}
          onClick={() => {
            void runOnServer();
          }}
        >
          {t("runOnServer")}
        </Button>
      </Stack>
      <FormRenderer
        version={definition}
        values={values}
        mode="preview"
        context={{ formKey, version }}
        expressionContext={expressionContext}
        onChange={(next) => {
          // 改了測試值,後端上一輪的結果就過期了:回到前端即時算,等下一次「以後端重算」
          fill.change(next);
          setResult(null);
        }}
        serverState={result}
        fieldErrors={result?.fieldErrors ?? []}
      />
      {failure !== null && <Alert severity="error">{failure}</Alert>}
      {result !== null && (
        <Alert
          severity={result.fieldErrors.length === 0 ? "success" : "warning"}
        >
          {t("serverSummary", {
            title: result.summary.title ?? "—",
            date:
              result.summary.date === null
                ? "—"
                : temporalText(result.summary.date, summaryDateType),
            amount: result.summary.amount ?? "—",
            errors: result.fieldErrors.length,
          })}
        </Alert>
      )}
      {isPrefilling && (
        <LookupDialog
          definition={definition}
          formKey={formKey}
          version={version}
          values={values}
          canEdit={() => true}
          onApply={(patch) => {
            fill.change({ ...values, ...patch });
            setResult(null);
            setIsPrefilling(false);
          }}
          onClose={() => {
            setIsPrefilling(false);
          }}
        />
      )}
    </Stack>
  );
};
