import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useUrlState } from "@/hooks/base/useUrlState";
import { LIST_PAGE_SHELL_SX } from "@/lib/base/list-page-layout";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { urlStateDefault } from "@/lib/base/url-state";

import { DEALERS_TABS } from "../dealers-keys";
import { DEALERS_LIST_KEY, classAListSchema } from "../dealers-list";
import { useDealersAccess } from "../useDealersAccess";
import { ClassADealersTab } from "./ClassADealersTab";
import { ClassBDealersTab } from "./ClassBDealersTab";
import { ContactsTab } from "./ContactsTab";

/** 與 `PageTabs` 同一個 `?tab=`(只讀,決定右上角是哪一顆新增按鈕);空字串 = 第一個分頁。 */
const tabSchema = z.string().default("");

/** 切分頁時把共用的 `?list=` 清回預設(寫回預設值 = 從網址拿掉;三個分頁的預設都是空物件)。 */
const urlListDefault = urlStateDefault(classAListSchema);

/**
 * 經銷商管理(`dealers`,正本 docs/modules/project/dealers.md「admin 頁面」;Figma DE-01 / DE-02 / DE-07):
 * 頁內分頁 甲類 | 乙類 | 關係人(關係人分頁要綁 `dealers.contacts`)+ 右上新增按鈕(跟著分頁換)。
 * 沒有 `dealers.create` / `dealers.contacts.create` 時按鈕不顯示(規格 5.2、5.3)。
 */
export const DealersPage = ({ module }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const access = useDealersAccess();
  const [tab] = useUrlState("tab", tabSchema);
  const [, setList] = useUrlState(DEALERS_LIST_KEY, classAListSchema);

  const items: PageTabItem[] = [
    {
      value: DEALERS_TABS.classA,
      label: t("tabs.classA"),
      content: <ClassADealersTab access={access} />,
    },
    {
      value: DEALERS_TABS.classB,
      label: t("tabs.classB"),
      content: <ClassBDealersTab access={access} />,
    },
    ...(access.hasContacts
      ? [
          {
            value: DEALERS_TABS.contacts,
            label: t("tabs.contacts"),
            content: <ContactsTab access={access} />,
          },
        ]
      : []),
  ];
  const isContacts = tab === DEALERS_TABS.contacts && access.hasContacts;

  let action = null;
  if (isContacts && access.canCreateContact) {
    action = (
      <Button
        onClick={() => {
          access.goTo(access.routes.contactCreate);
        }}
      >
        {t("actions.newContact")}
      </Button>
    );
  } else if (!isContacts && access.canCreateDealer) {
    action = (
      <Button
        onClick={() => {
          access.goTo(access.routes.create);
        }}
      >
        {t("actions.newDealer")}
      </Button>
    );
  }

  return (
    // 列表分頁的分頁殼(STYLE-08):平板以上釘高、表格在卡片裡捲(表頭固定);手機寬不釘高,整頁捲
    <Card
      sx={{
        ...LIST_PAGE_SHELL_SX,
        display: "flex",
        flexDirection: "column",
        px: { xs: 2, sm: 3 },
        py: 2,
      }}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
            {module.name}
          </Typography>
          {action}
        </Stack>
        <PageTabs
          aria-label={t("tabs.label")}
          items={items}
          onChange={() => {
            setList(urlListDefault);
          }}
        />
      </Stack>
    </Card>
  );
};
