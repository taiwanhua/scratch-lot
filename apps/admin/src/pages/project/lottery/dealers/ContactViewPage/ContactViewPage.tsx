import { useTranslations } from "use-intl";

import {
  LotteryContactStatus,
  type LotteryDealerContactFieldsFragment,
  useLotteryDealerContactQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { DataTable } from "@repo/ui/data-table";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { Section } from "@/components/base/Section/Section";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { FieldGrid } from "../DealerFormPage/DealerFormSections";
import { ReadOnlyField } from "../ReadOnlyField";
import {
  CONTACT_ROLE_LABELS,
  CONTACT_STATUS_LABELS,
  DEALER_TYPE_LABELS,
} from "../dealer-labels";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { SECTION_PAGE_IDS } from "../dealers-keys";
import { useDealersAccess } from "../useDealersAccess";

/**
 * 關係人詳情頁(隱藏頁 `dealers.contacts.view-page`;Figma DE-08):
 * 基本資料、聯絡資訊、備註、系統資訊(收合)+ 關聯的經銷商。[編輯] 看 `abilities.canEdit`。
 */
export const ContactViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const query = useLotteryDealerContactQuery(session.client, {
    id: routeParam ?? "",
  });
  const contact = query.data?.lotteryDealerContact.item ?? null;
  useRouteTabItemLabel(contact?.name, "view");

  if (query.isLoading) {
    return <CircularProgress aria-label={t("common.loading")} />;
  }
  if (contact === null) {
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
  return <ContactView contact={contact} />;
};

const ContactView = ({
  contact,
}: {
  contact: LotteryDealerContactFieldsFragment;
}) => {
  const t = useTranslations("admin.lotteryDealers");
  const temporal = useTemporalText();
  const access = useDealersAccess();
  const pageId = SECTION_PAGE_IDS.contactDetail;
  const none = t("common.none");
  const date = (value: unknown) =>
    value === null || value === undefined ? none : temporal(value, "date");

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
          {contact.abilities.canEdit && access.routes.contactEdit !== null && (
            <Button
              onClick={() => {
                access.goTo(access.routes.contactEdit, contact.id);
              }}
            >
              {t("actions.edit")}
            </Button>
          )}
        </Stack>
        <Card sx={{ px: 3, py: 2 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Typography variant="h6" component="h1">
              {contact.name}
            </Typography>
            <Tag
              tone={
                contact.status === LotteryContactStatus.Active
                  ? "success"
                  : "grey"
              }
              label={t(CONTACT_STATUS_LABELS[contact.status])}
            />
          </Stack>
        </Card>

        <Section
          pageId={pageId}
          sectionKey="basic"
          title={t("sections.contactBasic")}
        >
          <FieldGrid>
            <ReadOnlyField label={t("fields.name")}>
              {contact.name}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.nationalId")}>
              {contact.nationalId}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.birthday")}>
              {date(contact.birthday)}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.roles")}>
              <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                {contact.roles.map((role) => (
                  <Tag key={role} label={t(CONTACT_ROLE_LABELS[role])} />
                ))}
              </Stack>
            </ReadOnlyField>
          </FieldGrid>
        </Section>

        <Section
          pageId={pageId}
          sectionKey="contact"
          title={t("sections.contactInfo")}
        >
          <FieldGrid>
            <ReadOnlyField label={t("fields.phone")}>
              {contact.phone ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.mobile")}>
              {contact.mobile ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.email")}>
              {contact.email ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.mailingAddress")}>
              {contact.mailingAddress ?? none}
            </ReadOnlyField>
            <ReadOnlyField label={t("fields.residentialAddress")}>
              {contact.residentialAddress ?? none}
            </ReadOnlyField>
          </FieldGrid>
        </Section>

        <Section pageId={pageId} sectionKey="note" title={t("sections.note")}>
          <Typography variant="body2">{contact.note ?? none}</Typography>
        </Section>

        <Section
          pageId={pageId}
          sectionKey="system"
          title={t("sections.system")}
          summary={t("summary.system", {
            date: date(contact.createdAt),
            name: contact.createdBy?.name ?? "",
          })}
          defaultCollapsed
        >
          <Typography variant="body2">
            {t("summary.system", {
              date: temporal(contact.createdAt, "datetime"),
              name: contact.createdBy?.name ?? "",
            })}
          </Typography>
        </Section>

        <Typography variant="subtitle1" component="h2">
          {t("detail.linkedDealers")}
        </Typography>
        <DataTable
          size="small"
          aria-label={t("detail.linkedDealers")}
          rows={contact.links}
          getRowKey={(link) => `${link.dealer.id}-${link.role}`}
          emptyMessage={t("common.empty")}
          onRowClick={
            access.routes.view === null
              ? undefined
              : (link) => {
                  access.goTo(access.routes.view, link.dealer.id);
                }
          }
          columns={[
            {
              key: "dealer",
              header: t("detail.dealer"),
              width: 220,
              accessor: (link) =>
                `${link.dealer.storeName ?? link.dealer.name} #${link.dealer.licenseNo}`,
            },
            {
              key: "type",
              header: t("detail.dealerType"),
              width: 100,
              accessor: (link) => t(DEALER_TYPE_LABELS[link.dealer.type]),
            },
            {
              key: "role",
              header: t("detail.role"),
              width: 120,
              accessor: (link) => t(CONTACT_ROLE_LABELS[link.role]),
            },
          ]}
        />
      </Stack>
    </Box>
  );
};
