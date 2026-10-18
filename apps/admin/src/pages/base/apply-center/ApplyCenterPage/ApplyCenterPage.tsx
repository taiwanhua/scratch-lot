import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useApplicableForms } from "@/hooks/base/useApplicableForms";
import {
  useApplyCenterCounts,
  useInvalidateApplyCenterCounts,
} from "@/hooks/base/useApplyCenterCounts";
import { useUrlState } from "@/hooks/base/useUrlState";
import { urlStateDefault } from "@/lib/base/url-state";

import { ApplyCenterTabLabel } from "./ApplyCenterTabLabel";
import { MyApplicationsTab } from "./MyApplicationsTab";
import { MyTasksTab } from "./MyTasksTab";
import { NewApplicationDialog } from "./NewApplicationDialog";
import {
  APPLY_CENTER_LIST_KEY,
  myApplicationsListSchema,
} from "./apply-center-list";

/** 共用 `?list=` 的預設值(寫回它 = key 從網址拿掉)。 */
const urlListDefault = urlStateDefault(myApplicationsListSchema);

/**
 * 申請中心(固定模組 `apply-center`,Spec 6b §8 畫面 8;正本 docs/modules/workflows.md「申請中心」):
 * 兩個**跨模組**的頁籤 —— 「我的申請」「待我審核」;右上「新申請」選模組 → 選表單 → 進該模組的新增頁。
 * 內容以「我」為邊界(我送的、派給我的),不套可見範圍與資料範圍。
 * 頁籤右側的數字 = `applyCenterCounts`(我進行中的申請數 / 待我處理的任務數):進頁與切頁籤各重取一次。
 *
 * 分頁用 `PageTabs`(`?tab=mine|tasks`);列表篩選與頁碼在 `?list=`(兩個分頁共用,切分頁時清回預設)。
 */
export const ApplyCenterPage = () => {
  const t = useTranslations("admin.applyCenter");
  const { modules } = useApplicableForms();
  const counts = useApplyCenterCounts({ refetchOnMount: "always" });
  const invalidateCounts = useInvalidateApplyCenterCounts();
  // 只用來在切分頁時把共用的 `?list=` 清回預設(寫回預設值 = 從網址拿掉);讀取由各分頁自己的 schema 做
  const [, setList] = useUrlState(
    APPLY_CENTER_LIST_KEY,
    myApplicationsListSchema,
  );
  const [isCreating, setIsCreating] = useState(false);

  const items: PageTabItem[] = [
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
      content: <MyApplicationsTab modules={modules} />,
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
      content: <MyTasksTab modules={modules} />,
    },
  ];

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
      <PageTabs
        aria-label={t("tabs")}
        items={items}
        actions={
          <Button
            disabled={modules.length === 0}
            onClick={() => {
              setIsCreating(true);
            }}
          >
            {t("newApplication.open")}
          </Button>
        }
        onChange={() => {
          setList(urlListDefault);
          invalidateCounts();
        }}
      />
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
