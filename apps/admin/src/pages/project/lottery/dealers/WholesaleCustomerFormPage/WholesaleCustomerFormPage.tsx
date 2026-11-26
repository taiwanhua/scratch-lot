import { useTranslations } from "use-intl";

import {
  type LotteryWholesaleCustomerFieldsFragment,
  type LotteryWholesaleCustomerStatus,
  useLotteryWholesaleCustomerQuery,
  useLotteryWholesaleCustomerSameNamesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { CircularProgress } from "@repo/ui/circular-progress";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { Section } from "@/components/base/Section/Section";
import { ShareOrgsField } from "@/components/base/ShareOrgsField/ShareOrgsField";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { FieldGrid } from "../DealerFormPage/DealerFormSections";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { DEALERS_MODULE_KEYS, SECTION_PAGE_IDS } from "../dealers-keys";
import { type DealersAccess, useDealersAccess } from "../useDealersAccess";
import {
  WHOLESALE_CUSTOMER_STATUSES,
  WHOLESALE_CUSTOMER_STATUS_LABELS,
} from "../wholesale-customer-labels";
import { DeleteWholesaleCustomerButton } from "./DeleteWholesaleCustomerButton";
import { useWholesaleCustomerForm } from "./useWholesaleCustomerForm";

/** 文字欄位的文案 key(字面值)。 */
const TEXT_LABELS = {
  storeName: "wholesale.fields.storeName",
  licenseNo: "wholesale.fields.licenseNo",
  contactName: "wholesale.fields.contactName",
  phone: "wholesale.fields.phone",
  address: "wholesale.fields.address",
  note: "fields.note",
} as const;

type TextKey = keyof typeof TEXT_LABELS;

/**
 * 新增 / 編輯批售客戶(隱藏頁 `dealers.wholesale-customers.create-page` / `edit-page`;規格 21.2、Figma DE-11a / DE-11b):
 * ①基本資料(含「共用給」)②備註。店名同名只提醒、不擋;編輯頁有 [刪除]。
 */
export const WholesaleCustomerFormPage = ({
  module,
  routeParam,
}: ModulePageProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const access = useDealersAccess();
  const isCreate =
    module.key === DEALERS_MODULE_KEYS.wholesaleCustomerCreatePage;
  const query = useLotteryWholesaleCustomerQuery(
    session.client,
    { id: routeParam ?? "" },
    { enabled: !isCreate && routeParam !== null && routeParam !== undefined },
  );
  const customer = query.data?.lotteryWholesaleCustomer.item ?? null;
  useRouteTabItemLabel(customer?.storeName, "edit");

  if (isCreate) {
    return <WholesaleCustomerFormBody customer={null} access={access} />;
  }
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
  return (
    <WholesaleCustomerFormBody
      key={customer.id}
      customer={customer}
      access={access}
    />
  );
};

/** 同名提醒(只提醒、不擋):沒有同名 → null。 */
const useSameNameText = (
  storeName: string,
  excludeId: string | undefined,
): string | null => {
  const t = useTranslations("admin.lotteryDealers.wholesale");
  const { session } = useSession();
  const trimmed = storeName.trim();
  const query = useLotteryWholesaleCustomerSameNamesQuery(
    session.client,
    { input: { storeName: trimmed, excludeId } },
    { enabled: trimmed !== "" },
  );
  const items = query.data?.lotteryWholesaleCustomerSameNames.items ?? [];
  if (trimmed === "" || items.length === 0) {
    return null;
  }
  return t("sameName", {
    names: items
      .map((item) =>
        item.phone == null
          ? item.storeName
          : t("sameNameItem", { name: item.storeName, phone: item.phone }),
      )
      .join("、"),
  });
};

const WholesaleCustomerFormBody = ({
  customer,
  access,
}: {
  customer: LotteryWholesaleCustomerFieldsFragment | null;
  access: DealersAccess;
}) => {
  const t = useTranslations("admin.lotteryDealers");
  const pageId =
    customer === null
      ? SECTION_PAGE_IDS.wholesaleCustomerCreate
      : SECTION_PAGE_IDS.wholesaleCustomerEdit;
  const goToView = (id: string) => {
    if (access.routes.wholesaleCustomerView === null) {
      access.goTo(access.routes.list);
    } else {
      access.goTo(access.routes.wholesaleCustomerView, id);
    }
  };
  const form = useWholesaleCustomerForm(customer, access, goToView);
  const { values, change, fieldErrors } = form;
  const sameNameText = useSameNameText(values.storeName, customer?.id);
  const sameNameHint =
    sameNameText === null ? undefined : (
      <Typography component="span" variant="inherit" color="warning">
        {sameNameText}
      </Typography>
    );

  // 欄位錯了就在欄位正下方寫原因(REACT-18);頁面底部只放通用句
  const text = (
    key: TextKey,
    options: { required?: boolean; multiline?: boolean } = {},
  ) => (
    <TextField
      label={t(TEXT_LABELS[key])}
      value={values[key]}
      required={options.required}
      multiline={options.multiline}
      error={fieldErrors[key] !== undefined}
      helperText={
        fieldErrors[key] ?? (key === "storeName" ? sameNameHint : undefined)
      }
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
          title={t("wholesale.sections.basic")}
        >
          <FieldGrid>
            {text("storeName", { required: true })}
            {text("licenseNo")}
            {text("contactName")}
            {text("phone")}
            {text("address")}
            <SelectField<LotteryWholesaleCustomerStatus>
              label={t("wholesale.fields.status")}
              value={values.status}
              size="small"
              fullWidth
              options={WHOLESALE_CUSTOMER_STATUSES.map((status) => ({
                value: status,
                label: t(WHOLESALE_CUSTOMER_STATUS_LABELS[status]),
              }))}
              onChange={(status) => {
                change("status", status);
              }}
            />
            {form.canShare && (
              <Box sx={{ gridColumn: "1 / -1" }}>
                <ShareOrgsField
                  label={t("fields.shareOrgs")}
                  size="small"
                  value={values.shareOrgs}
                  error={fieldErrors.shareOrgs !== undefined}
                  helperText={fieldErrors.shareOrgs}
                  onChange={(next) => {
                    change("shareOrgs", next);
                  }}
                />
              </Box>
            )}
          </FieldGrid>
        </Section>

        <Section pageId={pageId} sectionKey="note" title={t("sections.note")}>
          {text("note", { multiline: true })}
        </Section>

        {form.error !== null && <Alert severity="error">{form.error}</Alert>}

        <FormActions
          start={
            customer?.abilities.canEdit === true ? (
              <DeleteWholesaleCustomerButton
                customer={customer}
                access={access}
              />
            ) : undefined
          }
          cancel={{
            label: t("actions.cancel"),
            onClick: () => {
              if (customer === null) {
                access.goTo(access.routes.list);
              } else {
                goToView(customer.id);
              }
            },
          }}
          submit={{
            label: t("actions.save"),
            disabled: form.isSubmitting,
            onClick: () => {
              void form.submit();
            },
          }}
        />
      </Stack>
    </Box>
  );
};
