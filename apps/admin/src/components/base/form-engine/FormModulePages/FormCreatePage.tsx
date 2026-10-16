import { Navigate, useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useFormRuntimeVersion } from "@/hooks/base/useFormRuntimeVersion";
import {
  type ModuleFormSummary,
  useModuleForms,
} from "@/hooks/base/useModuleForms";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { FormPicker } from "../FormPicker";
import { FormCreateBody } from "./FormCreateBody";
import { formModuleKeyOf, useFormModuleAccess } from "./useFormModuleAccess";

/**
 * 表單模組新增頁(預設組裝;Spec 6a §8 畫面 9)。網址 `/<模組>/create-page/<formKey>`:
 * 沒帶表單 key 時,此刻可新增的表單一張 → 直接換到它、多張 → 先選;
 * 帶了但那張表單現在不能新增(停用、收回分派、退役目前版本)→ 說明原因,不給填。
 */
export const FormCreatePage = ({ module, routeParam }: ModulePageProps) => {
  const moduleKey = formModuleKeyOf(module.key);
  const t = useTranslations("admin.formEngine.pages");
  const tErrors = useTranslations("admin.formEngine.errors");
  const navigate = useNavigate();
  const access = useFormModuleAccess(moduleKey);
  const { forms, isLoading } = useModuleForms(moduleKey);
  const formKey = routeParam ?? null;
  const form: ModuleFormSummary | null =
    forms.find((candidate) => candidate.key === formKey) ?? null;
  const version = useFormRuntimeVersion(
    form?.key ?? null,
    form?.currentVersion ?? null,
  );

  const tabHref = useRouteTabHref();
  const backToList = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  if (isLoading || version.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }

  if (formKey === null) {
    const only = forms.length === 1 ? forms[0] : null;
    if (only !== null && access.createRoute !== null) {
      return <Navigate to={`${access.createRoute}/${only.key}`} replace />;
    }
    if (forms.length === 0) {
      return <Alert severity="info">{t("noFormsHint")}</Alert>;
    }
    return (
      <FormPicker
        forms={forms}
        onPick={(picked) => {
          void navigate(`${access.createRoute ?? ""}/${picked.key}`, {
            replace: true,
          });
        }}
        onClose={backToList}
      />
    );
  }

  if (form === null || version.definition === null) {
    return <Alert severity="error">{tErrors("FORM_NOT_AVAILABLE")}</Alert>;
  }

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <FormCreateBody
        moduleKey={moduleKey}
        form={form}
        definition={version.definition}
        access={access}
        onLeave={backToList}
      />
    </Card>
  );
};
