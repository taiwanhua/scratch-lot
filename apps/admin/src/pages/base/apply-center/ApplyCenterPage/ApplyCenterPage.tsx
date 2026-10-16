import { useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";

import { useApplicableForms } from "@/hooks/base/useApplicableForms";
import {
  useApplyCenterCounts,
  useInvalidateApplyCenterCounts,
} from "@/hooks/base/useApplyCenterCounts";

import { ApplyCenterTabLabel } from "./ApplyCenterTabLabel";
import { MyApplicationsTab } from "./MyApplicationsTab";
import { MyTasksTab } from "./MyTasksTab";
import { NewApplicationDialog } from "./NewApplicationDialog";

type ApplyCenterTab = "mine" | "tasks";

/**
 * 申請中心(固定模組 `apply-center`,Spec 6b §8 畫面 8;正本 docs/modules/workflows.md「申請中心」):
 * 兩個**跨模組**的頁籤 —— 「我的申請」「待我審核」;右上「新申請」選模組 → 選表單 → 進該模組的新增頁。
 * 內容以「我」為邊界(我送的、派給我的),不套可見範圍與資料範圍。
 * 頁籤右側的數字 = `applyCenterCounts`(我進行中的申請數 / 待我處理的任務數):進頁與切頁籤各重取一次。
 */
export const ApplyCenterPage = () => {
  const t = useTranslations("admin.applyCenter");
  const { modules } = useApplicableForms();
  const counts = useApplyCenterCounts({ refetchOnMount: "always" });
  const invalidateCounts = useInvalidateApplyCenterCounts();
  const [tab, setTab] = useState<ApplyCenterTab>("mine");
  const [isCreating, setIsCreating] = useState(false);

  return (
    <Card
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        px: 3,
        py: 2,
      }}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Tabs
              aria-label={t("tabs")}
              value={tab}
              onChange={(next) => {
                setTab(next === "tasks" ? "tasks" : "mine");
                invalidateCounts();
              }}
              items={[
                {
                  value: "mine",
                  label: (
                    <ApplyCenterTabLabel
                      text={t("tabMine")}
                      count={counts.myApplications}
                      color="default"
                    />
                  ),
                  "aria-label":
                    counts.myApplications > 0
                      ? t("tabMineCount", { count: counts.myApplications })
                      : t("tabMine"),
                },
                {
                  value: "tasks",
                  label: (
                    <ApplyCenterTabLabel
                      text={t("tabTasks")}
                      count={counts.myTasks}
                      color="primary"
                    />
                  ),
                  "aria-label":
                    counts.myTasks > 0
                      ? t("tabTasksCount", { count: counts.myTasks })
                      : t("tabTasks"),
                },
              ]}
            />
          </Box>
          <Button
            disabled={modules.length === 0}
            onClick={() => {
              setIsCreating(true);
            }}
          >
            {t("newApplication.open")}
          </Button>
        </Stack>
        {tab === "mine" ? (
          <MyApplicationsTab modules={modules} />
        ) : (
          <MyTasksTab modules={modules} />
        )}
      </Stack>
      {isCreating && (
        <NewApplicationDialog
          modules={modules}
          onClose={() => {
            setIsCreating(false);
          }}
        />
      )}
    </Card>
  );
};
