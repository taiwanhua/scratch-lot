import { useTranslations } from "use-intl";

import type { FormFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface FormMobileSummaryProps {
  /** 選中的那一個;null = 還在載入或清單是空的 */
  form: FormFieldsFragment | null;
  /** 沒有選中時顯示的文字(載入中 / 沒有資料) */
  emptyText: string;
  /** 網址上有選取:顯示這一邊(否則藏起來,清單那一邊滿版) */
  isShown: boolean;
  /** [← 返回]:清掉選取回清單 */
  onBack: () => void;
}

/** 摘要標籤欄的最小寬(theme.spacing 單位),讓各列的值對齊。 */
const LABEL_WIDTH = 12;

/** 摘要的一列:標籤 + 值(唯讀)。 */
const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" spacing={1.5}>
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ flexShrink: 0, minWidth: (theme) => theme.spacing(LABEL_WIDTH) }}
    >
      {label}
    </Typography>
    <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {value}
    </Typography>
  </Stack>
);

/**
 * 表單管理在手機寬(< `sm`)的詳情:只顯示基本資料與設定摘要(唯讀),並提示到平板或電腦設計、編輯 ——
 * 設計器與各項設定需要寬畫面,手機上不提供(`FormsPage`)。
 */
const FormMobileSummaryCard = ({ form }: { form: FormFieldsFragment }) => {
  const t = useTranslations("admin.forms");
  const yesNo = (value: boolean) => t(value ? "mobile.yes" : "mobile.no");
  const version =
    form.currentVersion === null || form.currentVersion === undefined
      ? t("list.noVersion")
      : t("list.version", { version: form.currentVersion });

  return (
    <Card
      component="section"
      aria-label={t("mobile.region")}
      sx={{ flex: 1, minWidth: 0, p: 2.5 }}
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="h1">
            {form.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("detail.meta", {
              key: form.key,
              module: form.moduleName ?? form.moduleKey,
            })}
          </Typography>
          {form.forkedFrom !== null && form.forkedFrom !== undefined && (
            <Typography variant="body2" color="text.secondary">
              {t("detail.forkedFrom", {
                key: form.forkedFrom.formKey,
                version: form.forkedFrom.version,
              })}
            </Typography>
          )}
        </Stack>
        <Alert severity="info">{t("mobile.hint")}</Alert>
        <Stack spacing={1}>
          <SummaryRow
            label={t("mobile.version")}
            value={
              form.hasDraft ? `${version} · ${t("list.hasDraft")}` : version
            }
          />
          {form.tenantEnabled !== null && form.tenantEnabled !== undefined && (
            <SummaryRow
              label={t("detail.tenantEnabled")}
              value={yesNo(form.tenantEnabled)}
            />
          )}
          <SummaryRow
            label={t("detail.allowDraft")}
            value={yesNo(form.allowDraft)}
          />
          <SummaryRow
            label={t("detail.serial")}
            value={yesNo(form.serial !== null && form.serial !== undefined)}
          />
        </Stack>
        {form.assignments.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("detail.assignedTo", {
              tenants: form.assignments
                .map((item) => item.tenantName ?? item.tenantOrgId)
                .join("、"),
            })}
          </Typography>
        )}
      </Stack>
    </Card>
  );
};

/**
 * 手機寬(< `sm`)主從頁的詳情那一邊(REACT-17):頂部 [← 返回] + 唯讀摘要;
 * 沒有選取時藏起來(不卸載),由清單那一邊滿版。
 */
export const FormMobileSummary = ({
  form,
  emptyText,
  isShown,
  onBack,
}: FormMobileSummaryProps) => {
  const t = useTranslations("admin.forms");
  return (
    <Stack
      spacing={1}
      sx={{ display: isShown ? "flex" : "none", flex: 1, minWidth: 0 }}
    >
      <Box>
        <Button variant="text" size="small" onClick={onBack}>
          {t("mobile.back")}
        </Button>
      </Box>
      {form === null ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <FormMobileSummaryCard form={form} />
      )}
    </Stack>
  );
};
