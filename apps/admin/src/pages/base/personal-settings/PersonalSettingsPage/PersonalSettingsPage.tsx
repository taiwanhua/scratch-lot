import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useUrlState } from "@/hooks/base/useUrlState";

import { DelegationsTab } from "./DelegationsTab/DelegationsTab";
import { NewDelegationDialog } from "./DelegationsTab/NewDelegationDialog";
import { PreferencesTab } from "./PreferencesTab";
import {
  DELEGATIONS_LIST_KEY,
  PERSONAL_SETTINGS_TABS,
  delegationsListSchema,
} from "./delegations-list";

/** 只用來決定分頁列右側要不要放「新增代理」(讀取同 PageTabs 的 `?tab=`)。 */
const tabSchema = z.string().default("");

/**
 * 個人設定:殼層路由 `/settings/personal`,
 * 不是模組、不需要權限。分頁「偏好 | 代理人」記在網址 `?tab=`(PageTabs);代理人分頁的頁碼在 `?list=`,
 * 切分頁時清回預設。語言與外觀不在這裡 —— 兩者只放頭像選單,切了立即生效。
 */
export const PersonalSettingsPage = () => {
  const t = useTranslations("admin.personalSettings");
  const [tab] = useUrlState("tab", tabSchema);
  const [, setList] = useUrlState(DELEGATIONS_LIST_KEY, delegationsListSchema);
  const [isCreating, setIsCreating] = useState(false);

  const items: PageTabItem[] = [
    {
      value: PERSONAL_SETTINGS_TABS.preferences,
      label: t("tabPreferences"),
      content: <PreferencesTab />,
    },
    {
      value: PERSONAL_SETTINGS_TABS.delegations,
      label: t("tabDelegations"),
      content: <DelegationsTab />,
    },
  ];

  return (
    // 頁內分頁殼(STYLE-08):內容少時撐滿、多時跟著長,交給 <main> 捲;不釘高也不可被壓扁
    // (Card 預設 overflow: hidden,預設的 flex-shrink: 1 會把它壓到殼高、裁掉偏好清單與代理人表格的下半)
    <Card
      sx={{
        flexGrow: 1,
        flexShrink: 0,
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
          tab === PERSONAL_SETTINGS_TABS.delegations ? (
            <Button
              onClick={() => {
                setIsCreating(true);
              }}
            >
              {t("delegations.create")}
            </Button>
          ) : undefined
        }
        onChange={() => {
          setList({ page: 1 });
        }}
      />
      {isCreating && (
        <NewDelegationDialog
          onClose={() => {
            setIsCreating(false);
          }}
        />
      )}
    </Card>
  );
};
