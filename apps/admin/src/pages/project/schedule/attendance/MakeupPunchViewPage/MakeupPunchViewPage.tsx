import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { makeupPunchStateOf } from "../MakeupPunchFormPage/makeup-punch-form";
import { MAKEUP_PUNCH_MODULE_KEY } from "../attendance-keys";
import { useAttendanceText } from "../useAttendanceText";

/**
 * 補打卡申請的檢視 / 審核頁(SC-30;規格 14.8;替換表單引擎的檢視頁):申請人、日期、分店、類型、時間、
 * 原因、當天排班(對應排班)+ 審核區塊。審核中選的那筆排班被刪除時的警告與停用 [核准] 由模組登記的
 * 審核畫面擴充 `MakeupPunchReview` 畫(申請中心同一份)。
 */
export const MakeupPunchViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.schedule.attendance.makeup");
  const tAttendance = useTranslations("admin.schedule.attendance");
  const tPages = useTranslations("admin.formEngine.pages");
  const text = useAttendanceText();
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const access = useFormModuleAccess(MAKEUP_PUNCH_MODULE_KEY);
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo ?? t("title"));

  const values = submission === null ? null : submission.values;
  const state =
    values === null ? null : makeupPunchStateOf(values, text.timezone);
  const branch = values?.branch;
  const branchName =
    typeof branch === "object" &&
    branch !== null &&
    typeof (branch as { label?: unknown }).label === "string"
      ? (branch as { label: string }).label
      : (submission?.displayValues
          .find((item) => item.fieldKey === "branch")
          ?.items.at(0)?.label ?? "");

  const rows: [string, string][] =
    state === null
      ? []
      : [
          [t("applicant"), submission?.createdBy?.name ?? ""],
          [t("date"), state.date === "" ? "" : text.dateTitle(state.date)],
          [t("branch"), branchName],
          [
            t("type"),
            state.type === "in"
              ? tAttendance("types.in")
              : tAttendance("types.out"),
          ],
          [t("time"), state.time],
          [t("reason"), state.reasonLabel],
          ...(state.note === ""
            ? []
            : ([[t("note"), state.note]] as [string, string][])),
          [
            t("entry"),
            state.entry === "none" ? t("noEntry") : state.entryLabel,
          ],
        ];

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <Stack spacing={2.25} sx={{ maxWidth: 760 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              if (access.listRoute !== null) {
                void navigate(tabHref(access.listRoute));
              }
            }}
          >
            {tPages("backToList")}
          </Button>
          <Box sx={{ flex: 1 }} />
          {access.editRoute !== null &&
            submission?.abilities.canEdit === true && (
              <Button
                onClick={() => {
                  void navigate(`${access.editRoute ?? ""}/${id}`);
                }}
              >
                {tPages("edit")}
              </Button>
            )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h6" component="h1">
            {serialNo === null ? t("title") : t("titleWithNo", { serialNo })}
          </Typography>
          {submission !== null && (
            <SubmissionStatusTag
              status={submission.status}
              blocked={submission.blocked}
            />
          )}
        </Stack>
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
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: "contents" }}>
              <Typography component="dt" variant="body2" color="text.secondary">
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
        {submission?.currentInstanceId !== null &&
          submission?.currentInstanceId !== undefined && (
            <ApprovalSection
              instanceId={submission.currentInstanceId}
              submission={submission}
              onCopied={(copiedId) => {
                if (access.editRoute !== null) {
                  void navigate(`${access.editRoute}/${copiedId}`);
                }
              }}
            />
          )}
      </Stack>
    </Card>
  );
};
