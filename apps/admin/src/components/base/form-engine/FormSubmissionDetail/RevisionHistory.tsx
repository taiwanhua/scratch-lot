import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionFieldsFragment,
  useFormSubmissionRevisionsQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { RevisionDiff } from "./RevisionDiff";

export interface RevisionHistoryProps {
  submission: FormSubmissionFieldsFragment;
  /** 目前畫面上看的是哪個修訂(null = 目前) */
  viewedRevision: number | null;
  onViewRevision: (revision: number | null) => void;
}

/**
 * 修訂紀錄清單(Spec 6a §8 畫面 11;放在詳情的「修訂紀錄」跳窗裡):已完成的提交每改一次修訂號 +1,
 * 每個修訂都留完整快照。每列「修訂 N、誰、什麼時候」(時間以讀者現在的租戶時區印),
 * 可切換檢視那個修訂(唯讀渲染的條件用它自己的 `ctx`、定義用它自己的版本),修訂 2 起可看與前一修訂的差異。
 * 舊版資料升級產生的修訂印「誰於何時升級到第 N 版」(用 `upgradedBy` / `upgradedAt`;那一筆的 ctx 沿用上一筆)。
 * 清單只在跳窗打開時查(`formSubmission.revisions`;列表與詳情不載入修訂)。
 */
export const RevisionHistory = ({
  submission,
  viewedRevision,
  onViewRevision,
}: RevisionHistoryProps) => {
  const t = useTranslations("admin.formEngine.detail");
  const temporalText = useTemporalText();
  const { session } = useSession();
  const [diffRevision, setDiffRevision] = useState<number | null>(null);
  const query = useFormSubmissionRevisionsQuery(
    session.client,
    { id: submission.id },
    { retry: false },
  );
  const revisions = (
    query.data?.formSubmission.submission.revisions ?? []
  ).toSorted((a, b) => b.revision - a.revision);

  if (query.isLoading) {
    return <CircularProgress size={20} aria-label={t("loading")} />;
  }
  if (revisions.length === 0) {
    return null;
  }

  return (
    <Stack component="section" spacing={1} aria-label={t("revisions")}>
      {revisions.map((entry) => {
        const isViewed =
          (viewedRevision ?? submission.revision) === entry.revision;
        return (
          <Stack key={entry.revision} spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {entry.kind === "upgrade"
                  ? t("revisionUpgradedLine", {
                      revision: entry.revision,
                      user: entry.upgradedBy?.name ?? "—",
                      at: temporalText(
                        entry.upgradedAt ?? entry.at,
                        "datetime",
                      ),
                      version: entry.version,
                    })
                  : t("revisionLine", {
                      revision: entry.revision,
                      user: entry.user?.name ?? "—",
                      at: temporalText(entry.at, "datetime"),
                    })}
              </Typography>
              {isViewed ? (
                <Tag tone="primary" label={t("viewing")} />
              ) : (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    onViewRevision(
                      entry.revision === submission.revision
                        ? null
                        : entry.revision,
                    );
                  }}
                >
                  {t("viewRevision", { revision: entry.revision })}
                </Button>
              )}
              {entry.revision > 1 && (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    setDiffRevision(
                      diffRevision === entry.revision ? null : entry.revision,
                    );
                  }}
                >
                  {t("showDiff", { revision: entry.revision })}
                </Button>
              )}
            </Stack>
            {diffRevision === entry.revision && (
              <RevisionDiff
                submissionId={submission.id}
                formKey={submission.formKey}
                revision={entry.revision}
              />
            )}
          </Stack>
        );
      })}
    </Stack>
  );
};
