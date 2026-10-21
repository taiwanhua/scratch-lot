import { useTranslations } from "use-intl";

import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
  useLotteryDealerQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { PageTabs } from "@/components/base/PageTabs/PageTabs";
import { Section } from "@/components/base/Section/Section";
import { useMe } from "@/hooks/base/useMe";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { FieldGrid } from "../DealerFormPage/DealerFormSections";
import { ReadOnlyField } from "../ReadOnlyField";
import {
  DEALER_STATUS_LABELS,
  DEALER_STATUS_TONES,
  DEALER_TYPE_LABELS,
  LICENSE_TONES,
} from "../dealer-labels";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { DEALERS_PERMISSIONS, SECTION_PAGE_IDS } from "../dealers-keys";
import { rentSummaryOf } from "../rent-summary";
import { useDealersAccess } from "../useDealersAccess";
import { DEALER_DETAIL_TABS } from "./dealer-detail-tabs";

/**
 * 經銷商詳情頁(隱藏頁 `dealers.view-page`;Figma DE-04 甲類、DE-05 乙類)。
 * 標頭(姓名 · 類型 證號、狀態、摘要、[編輯])→ 區塊(經銷商資訊、店面、牌租、基本資訊、系統資訊;
 * 檢視時收合)→ 詳情分頁(`dealer-detail-tabs.ts` 的登記)。
 * [編輯] 看 api 的 `abilities.canEdit`;兩個批購基準日沒有 `show-` 權限時不顯示。
 */
export const DealerViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const query = useLotteryDealerQuery(session.client, { id: routeParam ?? "" });
  const dealer = query.data?.lotteryDealer.item ?? null;
  useRouteTabItemLabel(dealer?.storeName ?? dealer?.name, "view");

  if (query.isLoading) {
    return <CircularProgress aria-label={t("common.loading")} />;
  }
  if (dealer === null) {
    return (
      <Alert severity="error">
        {tErrors(
          query.error === null
            ? "NOT_FOUND"
            : dealersErrorKey(dealersErrorOf(query.error)),
        )}
      </Alert>
    );
  }
  return <DealerView dealer={dealer} />;
};

const DealerView = ({ dealer }: { dealer: LotteryDealerFieldsFragment }) => {
  const t = useTranslations("admin.lotteryDealers");
  const temporal = useTemporalText();
  const access = useDealersAccess();
  const me = useMe();
  const moduleKeys = new Set(
    (me.data?.me.modules ?? []).map((module) => module.key),
  );
  const isClassA = dealer.type === LotteryDealerType.A;
  const pageId = SECTION_PAGE_IDS.dealerDetail;
  const none = t("common.none");
  const date = (value: unknown) =>
    value === null || value === undefined ? none : temporal(value, "date");
  const names = (list: readonly { name: string }[]) =>
    list.length === 0 ? none : list.map((item) => item.name).join("、");
  const daysText = (value: unknown, days: number | null | undefined) =>
    days === null || days === undefined
      ? t("common.noRecord")
      : `${date(value)}(${t("common.days", { days: String(days) })})`;
  const rent = rentSummaryOf(t, {
    fee: dealer.rentFee ?? null,
    cycle: dealer.rentCycle ?? null,
    dueDay: dealer.rentDueDay ?? null,
  });

  const header = isClassA
    ? t("summary.classAHeader", {
        store:
          dealer.coSalesDealer?.storeName ??
          dealer.coSalesDealer?.name ??
          t("summary.notSelected"),
        lastPurchase: daysText(
          dealer.lastPurchaseDate,
          dealer.daysSinceLastPurchase,
        ),
        lastSelfPurchase: daysText(
          dealer.lastSelfPurchaseDate,
          dealer.daysSinceLastSelfPurchase,
        ),
      })
    : t("summary.classBHeader", {
        name: dealer.name,
        store: dealer.storeOrg?.name ?? t("summary.notSelected"),
      });

  const tabs = DEALER_DETAIL_TABS.filter(
    (tab) =>
      tab.types.includes(dealer.type) && (tab.visible?.(moduleKeys) ?? true),
  ).map(({ value, labelKey, Content }) => ({
    value,
    label: t(labelKey),
    content: <Content dealer={dealer} />,
  }));

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Stack spacing={2} sx={{ pb: 2 }}>
        {/* 檢視頁的頂部列(REACT-16):左 [← 返回列表],右 [編輯] */}
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              access.goTo(access.routes.list);
            }}
          >
            {t("actions.backToList")}
          </Button>
          <Box sx={{ flex: 1 }} />
          {dealer.abilities.canEdit && access.routes.edit !== null && (
            <Button
              onClick={() => {
                access.goTo(access.routes.edit, dealer.id);
              }}
            >
              {t("actions.edit")}
            </Button>
          )}
        </Stack>
        <Card sx={{ px: 3, py: 2 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 2 }}>
            <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
              <Stack
                direction="row"
                sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
              >
                <Typography variant="h6" component="h1">
                  {`${isClassA ? dealer.name : (dealer.storeName ?? dealer.name)} · ${t(DEALER_TYPE_LABELS[dealer.type])} ${dealer.licenseNo}`}
                </Typography>
                <Tag
                  tone={DEALER_STATUS_TONES[dealer.status]}
                  label={t(DEALER_STATUS_LABELS[dealer.status])}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {header}
              </Typography>
            </Stack>
          </Stack>
        </Card>

        <Section
          pageId={pageId}
          sectionKey="dealer"
          title={t("sections.dealer")}
          summary={t("summary.contacts", {
            agents: String(dealer.agents.length),
            trustees: String(dealer.trustees.length),
            expiresOn: date(dealer.licenseExpiresAt),
          })}
          defaultCollapsed
        >
          <FieldGrid>
            <ReadOnlyField label={t("fields.licenseNo")}>
              {dealer.licenseNo}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.name")}>
              {dealer.name}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.status")}>
              {t(DEALER_STATUS_LABELS[dealer.status])}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.licenseApprovedAt")}>
              {date(dealer.licenseApprovedAt)}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.licenseExpiresAt")}>
              <Box>
                <Tag
                  tone={LICENSE_TONES[dealer.licenseState]}
                  label={date(dealer.licenseExpiresAt)}
                />
              </Box>
            </ReadOnlyField>
            {isClassA && (
              <ReadOnlyField label={t("fields.coSalesDealerId")}>
                {dealer.coSalesDealer?.storeName ??
                  dealer.coSalesDealer?.name ??
                  none}
              </ReadOnlyField>
            )}
            <ReadOnlyField label={t("fields.agentIds")}>
              {names(dealer.agents)}
            </ReadOnlyField>
            {isClassA && (
              <ReadOnlyField label={t("fields.trusteeIds")}>
                {names(dealer.trustees)}
              </ReadOnlyField>
            )}
            <ReadOnlyField label={t("fields.introducerIds")}>
              {names(dealer.introducers)}
            </ReadOnlyField>
            {isClassA &&
              access.has(DEALERS_PERMISSIONS.showLastPurchaseBaseDate) && (
                <ReadOnlyField label={t("fields.lastPurchaseBaseDate")}>
                  {date(dealer.lastPurchaseBaseDate)}
                </ReadOnlyField>
              )}
            {isClassA &&
              access.has(DEALERS_PERMISSIONS.showLastSelfPurchaseBaseDate) && (
                <ReadOnlyField label={t("fields.lastSelfPurchaseBaseDate")}>
                  {date(dealer.lastSelfPurchaseBaseDate)}
                </ReadOnlyField>
              )}
          </FieldGrid>
        </Section>

        {!isClassA && (
          <Section
            pageId={pageId}
            sectionKey="store"
            title={t("sections.store")}
          >
            <FieldGrid>
              <ReadOnlyField label={t("fields.storeOrgId")}>
                {dealer.storeOrg?.name ?? t("summary.notSelected")}
              </ReadOnlyField>
              <ReadOnlyField label={t("fields.storeName")}>
                {dealer.storeName ?? none}
              </ReadOnlyField>
              <ReadOnlyField label={t("fields.terminalNo")}>
                {dealer.terminalNo ?? none}
              </ReadOnlyField>
              <ReadOnlyField label={t("fields.businessAddress")}>
                {dealer.businessAddress ?? none}
              </ReadOnlyField>
              <ReadOnlyField label={t("fields.storePhone")}>
                {dealer.storePhone ?? none}
              </ReadOnlyField>
            </FieldGrid>
          </Section>
        )}

        {!isClassA && (
          <Section
            pageId={pageId}
            sectionKey="rent"
            title={t("sections.rent")}
            summary={rent}
            defaultCollapsed
          >
            <Typography variant="body2">{rent}</Typography>
          </Section>
        )}

        <Section
          pageId={pageId}
          sectionKey="basic"
          title={t("sections.basic")}
          summary={dealer.mobile ?? undefined}
          defaultCollapsed
        >
          <FieldGrid>
            <ReadOnlyField label={t("fields.nationalId")}>
              {dealer.nationalId}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.birthday")}>
              {date(dealer.birthday)}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.mobile")}>
              {dealer.mobile ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.phone")}>
              {dealer.phone ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.email")}>
              {dealer.email ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.mailingAddress")}>
              {dealer.mailingAddress ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.residentialAddress")}>
              {dealer.residentialAddress ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.note")}>
              {dealer.note ?? none}
            </ReadOnlyField>
          </FieldGrid>
        </Section>

        <Section
          pageId={pageId}
          sectionKey="system"
          title={t("sections.system")}
          summary={t("summary.system", {
            date: date(dealer.createdAt),
            name: dealer.createdBy?.name ?? "",
          })}
          defaultCollapsed
        >
          <Typography variant="body2">
            {t("summary.system", {
              date: temporal(dealer.createdAt, "datetime"),
              name: dealer.createdBy?.name ?? "",
            })}
          </Typography>
        </Section>

        {tabs.length > 0 && (
          <PageTabs aria-label={t("detail.tabsLabel")} items={tabs} />
        )}
      </Stack>
    </Box>
  );
};
