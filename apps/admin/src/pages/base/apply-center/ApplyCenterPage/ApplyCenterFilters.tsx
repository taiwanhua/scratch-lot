import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import type { ApplicableModule } from "@/hooks/base/useApplicableForms";

const ALL = "";

export interface ApplyCenterFiltersProps {
  modules: readonly ApplicableModule[];
  moduleKey: string | null;
  onModuleKeyChange: (moduleKey: string | null) => void;
  formKey: string | null;
  onFormKeyChange: (formKey: string | null) => void;
  /** 頁籤自己的篩選(狀態 / 待處理 · 已處理) */
  children?: ReactNode;
}

/**
 * 申請中心兩個頁籤共用的篩選列:模組 → 表單(選了模組才列該模組的表單)。
 * 選項來自「新申請」的清單(我能新增且綁了流程的表單)。
 */
export const ApplyCenterFilters = ({
  modules,
  moduleKey,
  onModuleKeyChange,
  formKey,
  onFormKeyChange,
  children,
}: ApplyCenterFiltersProps) => {
  const t = useTranslations("admin.applyCenter.filters");
  const forms = modules
    .filter((module) => moduleKey === null || module.moduleKey === moduleKey)
    .flatMap((module) => module.forms);

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <SelectField
        label={t("module")}
        value={moduleKey ?? ALL}
        displayEmpty
        size="small"
        sx={{ width: 180 }}
        options={[
          { value: ALL, label: t("allModules") },
          ...modules.map((module) => ({
            value: module.moduleKey,
            label: module.moduleName ?? module.moduleKey,
          })),
        ]}
        onChange={(next) => {
          onModuleKeyChange(next === ALL ? null : next);
          onFormKeyChange(null);
        }}
      />
      <SelectField
        label={t("form")}
        value={formKey ?? ALL}
        displayEmpty
        size="small"
        sx={{ width: 200 }}
        options={[
          { value: ALL, label: t("allForms") },
          ...forms.map((form) => ({ value: form.key, label: form.name })),
        ]}
        onChange={(next) => {
          onFormKeyChange(next === ALL ? null : next);
        }}
      />
      {children}
    </Stack>
  );
};
