import { useTranslations } from "use-intl";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { FieldGrid } from "./DealerFormPage/DealerFormSections";
import { DealerInfoField } from "./DealerInfoField";

export interface SystemInfoFieldsProps {
  record: {
    ownerOrgName?: string | null;
    createdAt: string;
    createdBy?: { name: string } | null;
    updatedAt: string;
    updatedBy?: { name: string } | null;
  };
}

/**
 * 詳情頁「系統資訊」區塊的內容(經銷商、關係人共用):所屬組織、建立時間、建立者、最後修改時間、修改者。
 * 值都來自這筆資料本身(`orgId`、`createdAt` / `createdBy`、`updatedAt` / `updatedBy`)。
 */
export const SystemInfoFields = ({ record }: SystemInfoFieldsProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const temporal = useTemporalText();
  const none = t("common.none");
  return (
    <FieldGrid>
      <DealerInfoField label={t("fields.ownerOrg")}>
        {record.ownerOrgName ?? none}
      </DealerInfoField>
      <DealerInfoField label={t("fields.createdAt")}>
        {temporal(record.createdAt, "datetime")}
      </DealerInfoField>
      <DealerInfoField label={t("fields.createdBy")}>
        {record.createdBy?.name ?? none}
      </DealerInfoField>
      <DealerInfoField label={t("fields.updatedAt")}>
        {temporal(record.updatedAt, "datetime")}
      </DealerInfoField>
      <DealerInfoField label={t("fields.updatedBy")}>
        {record.updatedBy?.name ?? none}
      </DealerInfoField>
    </FieldGrid>
  );
};
