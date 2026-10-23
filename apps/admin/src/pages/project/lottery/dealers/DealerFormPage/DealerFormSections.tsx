import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import {
  LotteryContactRole,
  LotteryDealerType,
  LotteryRentCycle,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Checkbox } from "@repo/ui/checkbox";
import { DatePicker } from "@repo/ui/date-picker";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";

import { Section } from "@/components/base/Section/Section";
import { ShareOrgsField } from "@/components/base/ShareOrgsField/ShareOrgsField";

import {
  DEALER_STATUSES,
  DEALER_STATUS_LABELS,
  RENT_CYCLES,
  RENT_CYCLE_LABELS,
} from "../dealer-labels";
import { SECTION_PAGE_IDS } from "../dealers-keys";
import { CoSalesPicker } from "../pickers/CoSalesPicker";
import { ContactsPicker } from "../pickers/ContactsPicker";
import { StoreOrgPicker } from "../pickers/StoreOrgPicker";
import { rentSummaryOf } from "../rent-summary";
import type { DealerFormKey } from "./dealer-form-values";
import type { DealerForm } from "./useDealerForm";

/** 欄位的文案 key(字面值:死鍵掃描看得到)。 */
const LABELS: Record<
  Exclude<
    DealerFormKey,
    | "type"
    | "coSalesDealer"
    | "agents"
    | "trustees"
    | "introducers"
    | "shareOrgs"
  >,
  string
> = {
  licenseNo: "fields.licenseNo",
  name: "fields.name",
  status: "fields.status",
  licenseApprovedAt: "fields.licenseApprovedAt",
  licenseExpiresAt: "fields.licenseExpiresAt",
  lastPurchaseBaseDate: "fields.lastPurchaseBaseDate",
  lastSelfPurchaseBaseDate: "fields.lastSelfPurchaseBaseDate",
  storeOrgId: "fields.storeOrgId",
  storeName: "fields.storeName",
  businessAddress: "fields.businessAddress",
  storePhone: "fields.storePhone",
  terminalNo: "fields.terminalNo",
  rentFee: "fields.rentFee",
  rentCycle: "fields.rentCycle",
  rentStartMonth: "fields.rentStartMonth",
  rentDueDay: "fields.rentDueDay",
  nationalId: "fields.nationalId",
  birthday: "fields.birthday",
  phone: "fields.phone",
  mobile: "fields.mobile",
  email: "fields.email",
  mailingAddress: "fields.mailingAddress",
  residentialAddress: "fields.residentialAddress",
  residentialSameAsMailing: "fields.residentialSameAsMailing",
  note: "fields.note",
};

type TextKey =
  | "licenseNo"
  | "name"
  | "storeName"
  | "businessAddress"
  | "storePhone"
  | "terminalNo"
  | "rentFee"
  | "rentDueDay"
  | "nationalId"
  | "phone"
  | "mobile"
  | "email"
  | "mailingAddress"
  | "residentialAddress"
  | "note";

type DateKey =
  | "licenseApprovedAt"
  | "licenseExpiresAt"
  | "lastPurchaseBaseDate"
  | "lastSelfPurchaseBaseDate"
  | "birthday";

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** 欄位排成格子:電腦三欄、平板兩欄、手機一欄(規格第 16 章 RWD)。 */
export const FieldGrid = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      display: "grid",
      gap: 2,
      gridTemplateColumns: {
        xs: "1fr",
        sm: "repeat(2, minmax(0, 1fr))",
        md: "repeat(3, minmax(0, 1fr))",
      },
    }}
  >
    {children}
  </Box>
);

/** 跨整列的欄位。 */
const Wide = ({ children }: { children: ReactNode }) => (
  <Box sx={{ gridColumn: "1 / -1" }}>{children}</Box>
);

export interface DealerFormSectionsProps {
  form: DealerForm;
  dealerId: string | null;
  isCreate: boolean;
}

/**
 * 經銷商表單的區塊(底座 `Section`;規格 5.2「畫面」、Figma DE-03):
 * ①經銷商資訊(展開)②店面(乙類,展開)③牌租(乙類,收合,摘要「3,000 元 / 月」)
 * ④基本資訊(新增頁展開,編輯頁收合)。
 */
export const DealerFormSections = ({
  form,
  dealerId,
  isCreate,
}: DealerFormSectionsProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { values, change, fieldErrors } = form;
  const pageId = isCreate
    ? SECTION_PAGE_IDS.dealerCreate
    : SECTION_PAGE_IDS.dealerEdit;
  const isClassA = values.type === LotteryDealerType.A;
  // 欄位錯了就在欄位正下方寫原因(REACT-18);頁面底部只放通用句
  const errorText = (key: DealerFormKey) => fieldErrors[key];
  const isInvalid = (key: DealerFormKey) => errorText(key) !== undefined;

  const text = (
    key: TextKey,
    options: { required?: boolean; multiline?: boolean } = {},
  ) => (
    <TextField
      label={t(LABELS[key])}
      value={values[key]}
      required={options.required}
      multiline={options.multiline}
      minRows={options.multiline === true ? 2 : undefined}
      error={isInvalid(key)}
      helperText={errorText(key)}
      size="small"
      fullWidth
      onChange={(event) => {
        change(key, event.target.value);
      }}
    />
  );

  const date = (key: DateKey, options: { required?: boolean } = {}) => {
    const state = form.protectedFields[key];
    if (state !== undefined && !state.isVisible) {
      return null;
    }
    const isReadOnly = state !== undefined && !state.isWritable;
    return (
      <DatePicker
        label={t(LABELS[key])}
        value={values[key]}
        required={options.required}
        readOnly={isReadOnly}
        helperText={
          errorText(key) ?? (isReadOnly ? t("form.readOnlyField") : undefined)
        }
        error={isInvalid(key)}
        size="small"
        fullWidth
        onChange={(next) => {
          change(key, next);
        }}
      />
    );
  };

  const rentSummary = rentSummaryOf(t, {
    fee: values.rentFee === "" ? null : Number(values.rentFee),
    cycle: values.rentCycle,
    dueDay: values.rentDueDay === "" ? null : Number(values.rentDueDay),
  });

  return (
    <>
      <Section pageId={pageId} sectionKey="dealer" title={t("sections.dealer")}>
        <FieldGrid>
          {text("licenseNo", { required: true })}
          {text("name", { required: true })}
          <SelectField
            label={t(LABELS.status)}
            value={values.status}
            size="small"
            fullWidth
            options={DEALER_STATUSES.map((status) => ({
              value: status,
              label: t(DEALER_STATUS_LABELS[status]),
            }))}
            onChange={(status) => {
              change("status", status);
            }}
          />
          {date("licenseApprovedAt", { required: true })}
          {date("licenseExpiresAt", { required: true })}
          {isClassA && (
            <CoSalesPicker
              label={t("fields.coSalesDealerId")}
              value={values.coSalesDealer}
              error={isInvalid("coSalesDealer")}
              helperText={errorText("coSalesDealer") ?? t("form.coSalesHint")}
              onChange={(next) => {
                change("coSalesDealer", next);
              }}
            />
          )}
          <ContactsPicker
            label={t("fields.agentIds")}
            role={LotteryContactRole.Agent}
            value={values.agents}
            error={isInvalid("agents")}
            helperText={errorText("agents")}
            onChange={(next) => {
              change("agents", next);
            }}
          />
          {isClassA && (
            <ContactsPicker
              label={t("fields.trusteeIds")}
              role={LotteryContactRole.Trustee}
              value={values.trustees}
              error={isInvalid("trustees")}
              helperText={errorText("trustees")}
              onChange={(next) => {
                change("trustees", next);
              }}
            />
          )}
          <ContactsPicker
            label={t("fields.introducerIds")}
            role={LotteryContactRole.Introducer}
            value={values.introducers}
            error={isInvalid("introducers")}
            helperText={errorText("introducers")}
            onChange={(next) => {
              change("introducers", next);
            }}
          />
          {isClassA && date("lastPurchaseBaseDate")}
          {isClassA && date("lastSelfPurchaseBaseDate")}
        </FieldGrid>
      </Section>

      {!isClassA && (
        <Section pageId={pageId} sectionKey="store" title={t("sections.store")}>
          <FieldGrid>
            {values.storeOrgId === null && (
              <Wide>
                <Alert severity="warning">{t("form.storeOrgHint")}</Alert>
              </Wide>
            )}
            <StoreOrgPicker
              label={t(LABELS.storeOrgId)}
              value={values.storeOrgId}
              dealerId={dealerId}
              error={isInvalid("storeOrgId")}
              helperText={errorText("storeOrgId")}
              onChange={(next) => {
                change("storeOrgId", next);
              }}
            />
            {text("storeName")}
            {text("terminalNo")}
            {text("businessAddress")}
            {text("storePhone")}
          </FieldGrid>
        </Section>
      )}

      {!isClassA && (
        <Section
          pageId={pageId}
          sectionKey="rent"
          title={t("sections.rent")}
          summary={rentSummary}
          defaultCollapsed
        >
          <FieldGrid>
            {text("rentFee")}
            <SelectField<LotteryRentCycle | "">
              label={t(LABELS.rentCycle)}
              value={values.rentCycle ?? ""}
              displayEmpty
              size="small"
              fullWidth
              options={[
                { value: "", label: t("common.none") },
                ...RENT_CYCLES.map((cycle) => ({
                  value: cycle,
                  label: t(RENT_CYCLE_LABELS[cycle]),
                })),
              ]}
              onChange={(cycle) => {
                change("rentCycle", cycle === "" ? null : cycle);
              }}
            />
            {values.rentCycle !== null &&
              values.rentCycle !== LotteryRentCycle.Month && (
                <SelectField
                  label={t(LABELS.rentStartMonth)}
                  value={
                    values.rentStartMonth === null
                      ? ""
                      : String(values.rentStartMonth)
                  }
                  displayEmpty
                  required
                  error={isInvalid("rentStartMonth")}
                  helperText={errorText("rentStartMonth")}
                  size="small"
                  fullWidth
                  options={[
                    { value: "", label: t("common.none") },
                    ...MONTHS.map((month) => ({
                      value: String(month),
                      label: t("fields.month", { month: String(month) }),
                    })),
                  ]}
                  onChange={(month) => {
                    change(
                      "rentStartMonth",
                      month === "" ? null : Number(month),
                    );
                  }}
                />
              )}
            {text("rentDueDay")}
          </FieldGrid>
        </Section>
      )}

      <Section
        pageId={pageId}
        sectionKey="basic"
        title={t("sections.basic")}
        summary={values.mobile === "" ? undefined : values.mobile}
        defaultCollapsed={!isCreate}
      >
        <FieldGrid>
          {text("nationalId", { required: true })}
          {date("birthday")}
          {text("mobile")}
          {text("phone")}
          {text("email")}
          <Wide>{text("mailingAddress")}</Wide>
          <Wide>
            <FormControlLabel
              control={
                <Checkbox
                  checked={values.residentialSameAsMailing}
                  onChange={(event) => {
                    change("residentialSameAsMailing", event.target.checked);
                  }}
                />
              }
              label={t(LABELS.residentialSameAsMailing)}
            />
          </Wide>
          {!values.residentialSameAsMailing && (
            <Wide>{text("residentialAddress")}</Wide>
          )}
          <Wide>{text("note", { multiline: true })}</Wide>
          {form.canShare && (
            <Wide>
              <ShareOrgsField
                label={t("fields.shareOrgs")}
                size="small"
                value={values.shareOrgs}
                error={isInvalid("shareOrgs")}
                helperText={errorText("shareOrgs")}
                onChange={(next) => {
                  change("shareOrgs", next);
                }}
              />
            </Wide>
          )}
        </FieldGrid>
      </Section>
    </>
  );
};
