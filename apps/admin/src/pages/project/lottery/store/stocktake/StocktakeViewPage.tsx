import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  STORE_KEY,
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import {
  type LotteryStocktakeQuery,
  useLotteryStocktakeQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { moneyText } from "../store-text";

type Detail = LotteryStocktakeQuery["lotteryStocktake"];
type Line = Detail["lines"][number];

/**
 * 盤點確認申請的檢視頁(規格 8.6;Figma ST-30;替換表單引擎的檢視頁):申請人、送出時間、盤點單明細
 * (本 / 收銀點 / 方式 / 系統 / 實盤 / 差異張號 / 處理)、未拆的本、待查清單、彙總 + 審核。退回後申請人
 * [修改後再送出] 打開盤點頁(帶入原內容)。
 */
export const StocktakeViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.view");
  const tAll = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const temporal = useTemporalText();
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const access = useFormModuleAccess(STORE_KEY);
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const query = useLotteryStocktakeQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo ?? t("title"));
  const detail = query.data?.lotteryStocktake ?? null;

  const actionText = (line: Line) => {
    const counts = new Map<string, number>();
    for (const diff of line.diffs) {
      counts.set(diff.action, (counts.get(diff.action) ?? 0) + 1);
    }
    const suffix = line.diffs.some((diff) => diff.postClose)
      ? t("postClose")
      : "";
    return [...counts.entries()]
      .map(([action, count]) => {
        const label = t(`actions.${action}`);
        return line.diffs.length === 1
          ? label + suffix
          : `${label} ${String(count)}`;
      })
      .join("、");
  };
  const lostText = (line: Detail["lostReview"][number]) => {
    const reason = [line.reasonLabel, line.reasonNote]
      .filter((part) => part != null && part !== "")
      .join(" · ");
    const action = t(`lostActions.${line.action}`);
    const detail = reason === "" ? "" : "(" + reason + ")";
    return `${t("lost")} ${line.label}:${action}${detail}`;
  };
  const columns: TableColumn<Line>[] = [
    {
      key: "book",
      header: t("columns.book"),
      render: (line) =>
        `${line.gameCode} ${line.gameName} · ${displayBookNo(line.bookNo)}`,
    },
    {
      key: "cashPoint",
      header: t("columns.cashPoint"),
      render: (line) => line.cashPointName,
    },
    {
      key: "method",
      header: t("columns.method"),
      render: (line) => t(`methods.${line.method}`),
    },
    {
      key: "system",
      header: t("columns.system"),
      align: "right",
      render: (line) => line.systemCount,
    },
    {
      key: "present",
      header: t("columns.present"),
      align: "right",
      render: (line) => line.presentCount,
    },
    {
      key: "diff",
      header: t("columns.diffNos"),
      align: "right",
      render: (line) =>
        line.diffs.length === 0
          ? "—"
          : formatTicketRanges(line.diffs.map((diff) => diff.ticketNo)),
    },
    {
      key: "action",
      header: t("columns.action"),
      render: (line) =>
        line.diffs.length === 1 && line.diffs[0]?.action === "flag" ? (
          <Tag tone="error" label={t("actions.flag")} />
        ) : (
          actionText(line)
        ),
    },
  ];

  if (query.isError) {
    return <Alert severity="error">{t("loadFailed")}</Alert>;
  }
  const summary = detail?.summary;
  const facts: [string, string][] =
    summary === undefined
      ? []
      : [
          [
            t("summary.backfill"),
            t("backfillValue", {
              count: summary.backfillCount,
              amount: moneyText(summary.backfillAmount),
            }),
          ],
          [
            t("summary.newInvestigate"),
            t("count", { count: summary.newInvestigate }),
          ],
          [t("summary.flagged"), t("count", { count: summary.flagged })],
          [
            t("summary.confirmLost"),
            summary.confirmLostCost == null
              ? t("count", { count: summary.confirmLost })
              : t("lostValue", {
                  count: summary.confirmLost,
                  cost: moneyText(summary.confirmLostCost),
                }),
          ],
          [
            t("summary.uncounted"),
            t("books", { count: summary.uncountedCount }),
          ],
        ];
  const uncounted = detail?.uncountedBooks ?? [];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* 檢視頁的頂部列(REACT-16):左 [← 返回列表],右 [修改後再送出] */}
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1.5, flexShrink: 0 }}
      >
        <Button
          variant="text"
          size="small"
          onClick={() => {
            if (access.listRoute !== null) {
              void navigate(tabHref(access.listRoute));
            }
          }}
        >
          {t("backToList")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {access.editRoute !== null && submission?.abilities.canEdit === true ? (
          <Button
            onClick={() => {
              void navigate(`${access.editRoute ?? ""}/${id}`);
            }}
          >
            {t("edit")}
          </Button>
        ) : null}
      </Stack>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5, flexShrink: 0 }}>
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="h6" component="h1">
              {serialNo === null ? t("title") : t("titleWithNo", { serialNo })}
            </Typography>
            {submission === null ? null : (
              <SubmissionStatusTag
                status={submission.status}
                blocked={submission.blocked}
              />
            )}
          </Stack>
          {detail === null ? null : (
            <Typography variant="body2" color="textSecondary">
              {t("meta", {
                name: detail.submittedBy?.name ?? "",
                time: temporal(detail.submittedAt, "monthDayTime"),
                type: tAll(`types.${detail.type}`),
                scope: detail.scopeCashPoint?.name ?? tAll("page.wholeStore"),
              })}
            </Typography>
          )}
        </Stack>
      </Card>
      {detail === null ? null : (
        <>
          <Card sx={{ px: { xs: 2, sm: 3 }, py: 2, flexShrink: 0 }}>
            <Table
              columns={columns}
              rows={detail.lines}
              getRowKey={(line) => `${line.bookId}:${line.cashPointId}`}
              size="small"
              minWidth={720}
              emptyMessage={t("noLines")}
              containerSx={{ height: "auto" }}
            />
          </Card>
          {uncounted.length > 0 ? (
            <Card sx={{ px: { xs: 2, sm: 3 }, py: 2, flexShrink: 0 }}>
              <Stack spacing={1}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", flexWrap: "wrap" }}
                >
                  <Typography variant="subtitle2">{t("uncounted")}</Typography>
                  <Tag
                    tone="warning"
                    label={tAll("list.uncountedTag", {
                      count: uncounted.length,
                    })}
                  />
                  <Typography variant="body2" color="textSecondary">
                    {t("uncountedHint")}
                  </Typography>
                </Stack>
                {uncounted.map((book) => (
                  <Typography
                    key={`${book.bookId}:${book.cashPointId}`}
                    variant="body2"
                  >
                    {`${book.gameCode} ${book.gameName} · ${displayBookNo(book.bookNo)} · ${book.cashPointName}`}
                  </Typography>
                ))}
              </Stack>
            </Card>
          ) : null}
          {detail.unopened.length > 0 || detail.lostReview.length > 0 ? (
            <Card sx={{ px: { xs: 2, sm: 3 }, py: 2, flexShrink: 0 }}>
              <Stack spacing={1}>
                {detail.unopened.map((book) => (
                  <Typography key={book.bookNo} variant="body2">
                    {[
                      t("unopened"),
                      `${book.gameCode} ${book.gameName} · ${displayBookNo(book.bookNo)}:`,
                      book.present ? t("present") : t("absent"),
                    ].join(" ")}
                  </Typography>
                ))}
                {detail.lostReview.map((line) => (
                  <Typography key={line.label} variant="body2">
                    {lostText(line)}
                  </Typography>
                ))}
              </Stack>
            </Card>
          ) : null}
          <Card sx={{ px: { xs: 2, sm: 3 }, py: 2, flexShrink: 0 }}>
            <Box
              component="dl"
              sx={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 3,
                rowGap: 1,
                m: 0,
              }}
            >
              {facts.map(([label, value]) => (
                <Box key={label} sx={{ display: "contents" }}>
                  <Typography
                    component="dt"
                    variant="body2"
                    color="textSecondary"
                  >
                    {label}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body2"
                    sx={{ m: 0, textAlign: "right" }}
                  >
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Card>
        </>
      )}
      {submission?.currentInstanceId == null ? null : (
        <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5, flexShrink: 0 }}>
          <ApprovalSection
            instanceId={submission.currentInstanceId}
            submission={submission}
            onCopied={(copiedId) => {
              if (access.editRoute !== null) {
                void navigate(`${access.editRoute}/${copiedId}`);
              }
            }}
          />
        </Card>
      )}
    </Stack>
  );
};
