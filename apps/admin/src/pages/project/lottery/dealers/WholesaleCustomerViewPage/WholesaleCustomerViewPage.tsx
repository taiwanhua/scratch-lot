import { useTranslations } from "use-intl";

import {
  type LotteryWholesaleCustomerFieldsFragment,
  useLotteryWholesaleCustomerQuery,
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
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { FieldGrid } from "../DealerFormPage/DealerFormSections";
import { DealerInfoField } from "../DealerInfoField";
import { SystemInfoFields } from "../SystemInfoFields";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { SECTION_PAGE_IDS } from "../dealers-keys";
import { useDealersAccess } from "../useDealersAccess";
import {
  WHOLESALE_CUSTOMER_STATUS_LABELS,
  WHOLESALE_CUSTOMER_STATUS_TONES,
} from "../wholesale-customer-labels";
import { WHOLESALE_CUSTOMER_DETAIL_TABS } from "./wholesale-customer-detail-tabs";

/**
 * 批售客戶詳情頁(隱藏頁 `dealers.wholesale-customers.view-page`;規格 21.2、Figma DE-10a):
 * 標頭摘要 + 分頁(基本資料:①基本資料 ②備註 ③系統資訊(收合);其他分頁由登記追加)。[編輯] 看 `abilities.canEdit`。
 */
export const WholesaleCustomerViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const query = useLotteryWholesaleCustomerQuery(session.client, {
    id: routeParam ?? "",
  });
  const customer = query.data?.lotteryWholesaleCustomer.item ?? null;
  useRouteTabItemLabel(customer?.storeName, "view");

  if (query.isLoading) {
    return <CircularProgress aria-label={t("common.loading")} />;
  }
  if (customer === null) {
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
  return <WholesaleCustomerView customer={customer} />;
};

interface CustomerProps {
  customer: LotteryWholesaleCustomerFieldsFragment;
}

const WholesaleCustomerView = ({ customer }: CustomerProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const temporal = useTemporalText();
  const access = useDealersAccess();
  const summary = [
    customer.contactName == null
      ? null
      : t("wholesale.summary.contact", { name: customer.contactName }),
    customer.phone,
    t("wholesale.summary.lastWholesale", {
      date:
        customer.lastWholesaleAt == null
          ? t("common.noRecord")
          : temporal(customer.lastWholesaleAt, "date"),
    }),
  ].filter((part) => part != null);

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
          {customer.abilities.canEdit &&
            access.routes.wholesaleCustomerEdit !== null && (
              <Button
                onClick={() => {
                  access.goTo(access.routes.wholesaleCustomerEdit, customer.id);
                }}
              >
                {t("actions.edit")}
              </Button>
            )}
        </Stack>
        <Card sx={{ px: 3, py: 2 }}>
          <Stack spacing={1}>
            <Stack
              direction="row"
              sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
            >
              <Typography variant="h6" component="h1">
                {customer.licenseNo == null
                  ? customer.storeName
                  : t("wholesale.summary.title", {
                      name: customer.storeName,
                      licenseNo: customer.licenseNo,
                    })}
              </Typography>
              <Tag
                tone={WHOLESALE_CUSTOMER_STATUS_TONES[customer.status]}
                label={t(WHOLESALE_CUSTOMER_STATUS_LABELS[customer.status])}
              />
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {summary.join(" · ")}
            </Typography>
          </Stack>
        </Card>

        <PageTabs
          aria-label={t("wholesale.tabsLabel")}
          items={[
            {
              value: "basic",
              label: t("wholesale.sections.basic"),
              content: <BasicTab customer={customer} />,
            },
            ...WHOLESALE_CUSTOMER_DETAIL_TABS.filter((tab) =>
              access.has(tab.permission),
            ).map(({ value, labelKey, Content }) => ({
              value,
              label: t(labelKey),
              content: <Content customer={customer} />,
            })),
          ]}
        />
      </Stack>
    </Box>
  );
};

/** 基本資料分頁:①基本資料 ②備註 ③系統資訊(收合)。 */
const BasicTab = ({ customer }: CustomerProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const temporal = useTemporalText();
  const pageId = SECTION_PAGE_IDS.wholesaleCustomerDetail;
  const none = t("common.none");
  return (
    <Stack spacing={2}>
      <Section
        pageId={pageId}
        sectionKey="basic"
        title={t("wholesale.sections.basic")}
      >
        <FieldGrid>
          <DealerInfoField label={t("wholesale.fields.storeName")}>
            {customer.storeName}
          </DealerInfoField>
          <DealerInfoField label={t("wholesale.fields.licenseNo")}>
            {customer.licenseNo ?? none}
          </DealerInfoField>
          <DealerInfoField label={t("wholesale.fields.contactName")}>
            {customer.contactName ?? none}
          </DealerInfoField>
          <DealerInfoField label={t("wholesale.fields.phone")}>
            {customer.phone ?? none}
          </DealerInfoField>
          <DealerInfoField label={t("wholesale.fields.address")}>
            {customer.address ?? none}
          </DealerInfoField>
          <DealerInfoField label={t("wholesale.fields.status")}>
            {t(WHOLESALE_CUSTOMER_STATUS_LABELS[customer.status])}
          </DealerInfoField>
        </FieldGrid>
      </Section>
      <Section pageId={pageId} sectionKey="note" title={t("sections.note")}>
        <Typography variant="body2">{customer.note ?? none}</Typography>
      </Section>
      <Section
        pageId={pageId}
        sectionKey="system"
        title={t("sections.system")}
        summary={t("wholesale.summary.system", {
          org: customer.ownerOrgName ?? none,
          date: temporal(customer.createdAt, "date"),
        })}
        defaultCollapsed
      >
        <SystemInfoFields record={customer} />
      </Section>
    </Stack>
  );
};
