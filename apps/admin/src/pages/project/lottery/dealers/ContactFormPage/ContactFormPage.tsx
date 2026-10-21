import { useTranslations } from "use-intl";

import {
  LotteryContactStatus,
  type LotteryDealerContactFieldsFragment,
  useLotteryDealerContactQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Checkbox } from "@repo/ui/checkbox";
import { CircularProgress } from "@repo/ui/circular-progress";
import { DatePicker } from "@repo/ui/date-picker";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { Section } from "@/components/base/Section/Section";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { ConflictDialog } from "../ConflictDialog";
import { FieldGrid } from "../DealerFormPage/DealerFormSections";
import {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  CONTACT_STATUS_LABELS,
} from "../dealer-labels";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { DEALERS_MODULE_KEYS, SECTION_PAGE_IDS } from "../dealers-keys";
import { type DealersAccess, useDealersAccess } from "../useDealersAccess";
import { type ContactFormKey, useContactForm } from "./useContactForm";

/** 文字欄位的文案 key(字面值)。 */
const TEXT_LABELS = {
  name: "fields.name",
  nationalId: "fields.nationalId",
  phone: "fields.phone",
  mobile: "fields.mobile",
  email: "fields.email",
  mailingAddress: "fields.mailingAddress",
  residentialAddress: "fields.residentialAddress",
  note: "fields.note",
} as const satisfies Partial<Record<ContactFormKey, string>>;

type TextKey = keyof typeof TEXT_LABELS;

/**
 * 新增 / 編輯關係人(隱藏頁 `dealers.contacts.create-page` / `edit-page`;Figma DE-08):
 * ①基本資料(姓名、身分證字號、生日、身分至少一個、狀態)②聯絡資訊 ③備註。
 */
export const ContactFormPage = ({ module, routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const access = useDealersAccess();
  const isCreate = module.key === DEALERS_MODULE_KEYS.contactCreatePage;
  const query = useLotteryDealerContactQuery(
    session.client,
    { id: routeParam ?? "" },
    { enabled: !isCreate && routeParam !== null && routeParam !== undefined },
  );
  const contact = query.data?.lotteryDealerContact.item ?? null;
  useRouteTabItemLabel(contact?.name, "edit");

  if (isCreate) {
    return <ContactFormBody contact={null} access={access} />;
  }
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
  return <ContactFormBody key={contact.id} contact={contact} access={access} />;
};

const ContactFormBody = ({
  contact,
  access,
}: {
  contact: LotteryDealerContactFieldsFragment | null;
  access: DealersAccess;
}) => {
  const t = useTranslations("admin.lotteryDealers");
  const isCreate = contact === null;
  const pageId = isCreate
    ? SECTION_PAGE_IDS.contactCreate
    : SECTION_PAGE_IDS.contactEdit;
  const leave = () => {
    if (contact !== null && access.routes.contactView !== null) {
      access.goTo(access.routes.contactView, contact.id);
    } else {
      access.goTo(access.routes.list);
    }
  };
  const form = useContactForm(contact, (id) => {
    if (access.routes.contactView === null) {
      access.goTo(access.routes.list);
    } else {
      access.goTo(access.routes.contactView, id);
    }
  });
  const { values, change } = form;
  const isInvalid = (key: string) => form.invalidFields.includes(key);

  const text = (key: TextKey, options: { required?: boolean } = {}) => (
    <TextField
      label={t(TEXT_LABELS[key])}
      value={values[key]}
      required={options.required}
      error={isInvalid(key)}
      size="small"
      fullWidth
      onChange={(event) => {
        change(key, event.target.value);
      }}
    />
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Stack spacing={2} sx={{ pb: 2 }}>
        <Section
          pageId={pageId}
          sectionKey="basic"
          title={t("sections.contactBasic")}
        >
          <FieldGrid>
            {text("name", { required: true })}
            {text("nationalId", { required: true })}
            <DatePicker
              label={t("fields.birthday")}
              value={values.birthday}
              size="small"
              fullWidth
              onChange={(next) => {
                change("birthday", next);
              }}
            />
            <Box sx={{ gridColumn: "1 / -1" }}>
              <Stack
                direction="row"
                sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
              >
                <Typography
                  variant="body2"
                  color={isInvalid("roles") ? "error" : "text.secondary"}
                >
                  {t("fields.roles")}
                </Typography>
                {CONTACT_ROLES.map((role) => (
                  <FormControlLabel
                    key={role}
                    label={t(CONTACT_ROLE_LABELS[role])}
                    control={
                      <Checkbox
                        checked={values.roles.includes(role)}
                        onChange={(event) => {
                          change(
                            "roles",
                            event.target.checked
                              ? [...values.roles, role]
                              : values.roles.filter((item) => item !== role),
                          );
                        }}
                      />
                    }
                  />
                ))}
              </Stack>
            </Box>
            <SelectField<LotteryContactStatus>
              label={t("list.filters.status")}
              value={values.status}
              size="small"
              fullWidth
              options={[
                LotteryContactStatus.Active,
                LotteryContactStatus.Disabled,
              ].map((status) => ({
                value: status,
                label: t(CONTACT_STATUS_LABELS[status]),
              }))}
              onChange={(status) => {
                change("status", status);
              }}
            />
          </FieldGrid>
        </Section>

        <Section
          pageId={pageId}
          sectionKey="contact"
          title={t("sections.contactInfo")}
        >
          <FieldGrid>
            {text("phone")}
            {text("mobile")}
            {text("email")}
            <Box sx={{ gridColumn: "1 / -1" }}>{text("mailingAddress")}</Box>
            <Box sx={{ gridColumn: "1 / -1" }}>
              <FormControlLabel
                label={t("fields.residentialSameAsMailing")}
                control={
                  <Checkbox
                    checked={values.residentialSameAsMailing}
                    onChange={(event) => {
                      change("residentialSameAsMailing", event.target.checked);
                    }}
                  />
                }
              />
            </Box>
            {!values.residentialSameAsMailing && (
              <Box sx={{ gridColumn: "1 / -1" }}>
                {text("residentialAddress")}
              </Box>
            )}
          </FieldGrid>
        </Section>

        <Section pageId={pageId} sectionKey="note" title={t("sections.note")}>
          {text("note")}
        </Section>

        {form.error !== null && <Alert severity="error">{form.error}</Alert>}

        <FormActions
          cancel={{ label: t("actions.cancel"), onClick: leave }}
          submit={{
            label: t("actions.save"),
            disabled: form.isSubmitting,
            onClick: () => {
              void form.submit();
            },
          }}
        />
      </Stack>

      {form.conflict !== null && (
        <ConflictDialog
          title={t("conflict.roleTitle")}
          message={t("conflict.roleBody")}
          relationships={form.conflict.relationships}
          hiddenCount={form.conflict.hiddenCount}
          column="dealer"
          confirmLabel={t("actions.releaseAndSave")}
          isSubmitting={form.isSubmitting}
          onCancel={form.closeConflict}
          onConfirm={() => {
            void form.submit(true);
          }}
        />
      )}
    </Box>
  );
};
