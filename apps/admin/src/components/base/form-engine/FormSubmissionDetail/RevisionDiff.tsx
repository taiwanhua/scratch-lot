import { useTranslations } from "use-intl";

import { useFormSubmissionQuery } from "@repo/graphql";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useVersionDefinitions } from "@/hooks/base/useVersionDefinitions";
import {
  type RevisionChange,
  revisionChanges,
  revisionFieldsOf,
} from "@/lib/base/form-engine/revision-diff";

import { FormValue } from "../FormValue";
import { ArrayRevisionDiff } from "./ArrayRevisionDiff";

export interface RevisionDiffProps {
  submissionId: string;
  formKey: string;
  /** 看這個修訂相對於前一個修訂的差異(≥ 2) */
  revision: number;
}

/**
 * 修訂差異(`revisions[]`:每個修訂存完整快照,差異在讀取時由相鄰兩筆算)。
 * 兩個快照都走 `formSubmission(id, revision)`,所以受保護欄位的投影照讀者現在的權限套 —— 看不到的欄位兩邊
 * 都是 `"[redacted]"`,不會以「有變動」的形式側漏。明細列另外以 `rowId` 對列列出每一列的變動
 * (`ArrayRevisionDiff`)。
 * 兩個修訂各用自己的版本定義(`viewedVersion`;舊版資料升級後前後兩筆可能綁不同版本):
 * 欄位以這一修訂的版本為準、補上前一修訂版本才有的欄位,前一修訂那一格照它自己版本的欄位顯示。
 */
export const RevisionDiff = ({
  submissionId,
  formKey,
  revision,
}: RevisionDiffProps) => {
  const t = useTranslations("admin.formEngine.detail");
  const tValue = useTranslations("admin.formEngine.renderer");
  const { session } = useSession();
  const previous = useFormSubmissionQuery(session.client, {
    id: submissionId,
    revision: revision - 1,
  });
  const current = useFormSubmissionQuery(session.client, {
    id: submissionId,
    revision,
  });
  const before = previous.data?.formSubmission.submission;
  const after = current.data?.formSubmission.submission;
  const definitionOf = useVersionDefinitions(
    [before, after].flatMap((entry) =>
      entry === undefined ? [] : [{ formKey, version: entry.viewedVersion }],
    ),
  );
  const beforeDefinition =
    before === undefined
      ? undefined
      : definitionOf(formKey, before.viewedVersion);
  const afterDefinition =
    after === undefined
      ? undefined
      : definitionOf(formKey, after.viewedVersion);

  if (before === undefined || after === undefined) {
    return <CircularProgress size={20} aria-label={t("loadingDiff")} />;
  }
  if (beforeDefinition === undefined || afterDefinition === undefined) {
    return <CircularProgress size={20} aria-label={t("loadingDiff")} />;
  }

  const changes = revisionChanges(
    revisionFieldsOf(beforeDefinition.fields, afterDefinition.fields),
    before.values,
    after.values,
  );
  const beforeFieldOf = (change: RevisionChange) =>
    beforeDefinition.fields.find((field) => field.key === change.field.key) ??
    change.field;
  const text = {
    empty: tValue("empty"),
    yes: tValue("yes"),
    no: tValue("no"),
    unavailable: tValue("sourceUnavailable"),
  };
  // 日期 / 日期時間:`FormValue` 不帶時區 = 讀者現在的租戶時區(修訂的 ctx 時區不決定顯示)
  const displayOf = (source: typeof before, fieldKey: string) =>
    source.displayValues.find((entry) => entry.fieldKey === fieldKey)?.items ??
    [];

  if (changes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("noChanges")}
      </Typography>
    );
  }

  const arrayChanges = changes.filter(
    (change) => change.field.type === "array",
  );
  const valueChanges = changes.filter(
    (change) => change.field.type !== "array",
  );

  return (
    <Stack spacing={1.5}>
      {valueChanges.length > 0 && (
        <Table<RevisionChange>
          aria-label={t("diffAria", { revision })}
          size="small"
          rows={valueChanges}
          getRowKey={(change) => change.field.key}
          columns={[
            {
              key: "field",
              header: t("diffField"),
              render: (change) => change.field.label,
            },
            {
              key: "before",
              header: t("diffBefore", { revision: revision - 1 }),
              render: (change) => (
                <FormValue
                  field={beforeFieldOf(change)}
                  value={change.before}
                  display={displayOf(before, change.field.key)}
                  text={text}
                />
              ),
            },
            {
              key: "after",
              header: t("diffAfter", { revision }),
              render: (change) => (
                <FormValue
                  field={change.field}
                  value={change.after}
                  display={displayOf(after, change.field.key)}
                  text={text}
                />
              ),
            },
          ]}
        />
      )}
      {arrayChanges.map((change) => (
        <ArrayRevisionDiff
          key={change.field.key}
          field={change.field}
          before={change.before}
          after={change.after}
          text={text}
        />
      ))}
    </Stack>
  );
};
