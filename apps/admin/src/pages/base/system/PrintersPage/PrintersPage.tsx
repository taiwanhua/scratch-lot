import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useUrlState } from "@/hooks/base/useUrlState";
import { LIST_PAGE_SHELL_SX } from "@/lib/base/list-page-layout";
import { urlStateDefault } from "@/lib/base/url-state";

import { AgentsTab } from "./AgentsTab/AgentsTab";
import { CreateAgentDialog } from "./CreateAgentDialog/CreateAgentDialog";
import { PrintJobsTab } from "./PrintJobsTab/PrintJobsTab";
import { PrinterFormDialog } from "./PrinterFormDialog/PrinterFormDialog";
import { PrintersTab } from "./PrintersTab/PrintersTab";
import {
  PRINTERS_LIST_KEY,
  PRINTERS_TABS,
  type PrintersTabValue,
  printersListSchema,
} from "./printers-list";
import { PRINTERS_PERMISSIONS } from "./printers-permissions";
import { usePrintersLookups } from "./usePrintersLookups";

/** 與 `PageTabs` 同一個 `?tab=`(只讀,決定右上角是哪一顆新增按鈕);空字串 = 第一個分頁。 */
const tabSchema = z.string().default("");

/** 切分頁時把共用的 `?list=` 清回預設(寫回預設值 = 從網址拿掉)。 */
const urlListDefault = urlStateDefault(printersListSchema);

type Creatable = "printer" | "agent";

/** 各分頁右上的新增按鈕;列印紀錄沒有。 */
const CREATABLE_OF: Record<PrintersTabValue, Creatable | null> = {
  [PRINTERS_TABS.printers]: "printer",
  [PRINTERS_TABS.agents]: "agent",
  [PRINTERS_TABS.jobs]: null,
};

/**
 * 印表機管理(`system.printers`,正本 docs/modules/printers.md「admin 頁面」):
 * 版面沿用申請中心的卡片 —— 頁內分頁(印表機 | 代理程式 | 列印紀錄)+ 右上新增按鈕 + 篩選 + 表格 + 頁碼。
 *
 * 右上按鈕跟著分頁換:印表機分頁 [新增印表機]、代理程式分頁 [新增代理程式](都要 `create`);
 * 列印紀錄沒有。新增彈窗不進網址;編輯印表機彈窗在 `?edit=`(PrintersTab)。
 */
export const PrintersPage = () => {
  const t = useTranslations("admin.printers");
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission(PRINTERS_PERMISSIONS.create);
  const lookups = usePrintersLookups();
  const [tab] = useUrlState("tab", tabSchema);
  const [, setList] = useUrlState(PRINTERS_LIST_KEY, printersListSchema);
  const [creating, setCreating] = useState<"printer" | "agent" | null>(null);

  const items: PageTabItem[] = [
    {
      value: PRINTERS_TABS.printers,
      label: t("tabPrinters"),
      content: <PrintersTab lookups={lookups} />,
    },
    {
      value: PRINTERS_TABS.agents,
      label: t("tabAgents"),
      content: <AgentsTab lookups={lookups} />,
    },
    {
      value: PRINTERS_TABS.jobs,
      label: t("tabJobs"),
      content: <PrintJobsTab />,
    },
  ];
  const currentTab: PrintersTabValue =
    Object.values(PRINTERS_TABS).find((value) => value === tab) ??
    PRINTERS_TABS.printers;

  const creatable = CREATABLE_OF[currentTab];
  const action =
    !canCreate || creatable === null ? undefined : (
      <Button
        onClick={() => {
          setCreating(creatable);
        }}
      >
        {creatable === "agent" ? t("newAgent") : t("newPrinter")}
      </Button>
    );

  const close = () => {
    setCreating(null);
  };

  return (
    // 列表分頁的分頁殼(STYLE-08):平板以上釘高、表格在卡片裡捲(表頭固定);手機寬不釘高,整頁捲
    <Card
      sx={{
        ...LIST_PAGE_SHELL_SX,
        display: "flex",
        flexDirection: "column",
        px: 3,
        py: 2,
      }}
    >
      <PageTabs
        aria-label={t("tabs")}
        items={items}
        actions={action}
        onChange={() => {
          setList(urlListDefault);
        }}
      />
      {creating === "printer" && (
        <PrinterFormDialog printer={null} lookups={lookups} onClose={close} />
      )}
      {creating === "agent" && (
        <CreateAgentDialog lookups={lookups} onClose={close} />
      )}
    </Card>
  );
};
