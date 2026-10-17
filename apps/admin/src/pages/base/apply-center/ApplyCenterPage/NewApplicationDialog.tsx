import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import type { ApplicableModule } from "@/hooks/base/useApplicableForms";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";

import { formModulePageKey } from "../apply-center-keys";

export interface NewApplicationDialogProps {
  modules: readonly ApplicableModule[];
  onClose: () => void;
}

/**
 * 「新申請」(Spec 6b §8 畫面 8):選模組 → 選表單 → 進該模組的新增頁
 * (`/<模組>/create-page/<表單 key>`,表單都留在各自的業務模組)。只列我能新增且綁了流程的表單。
 */
export const NewApplicationDialog = ({
  modules,
  onClose,
}: NewApplicationDialogProps) => {
  const t = useTranslations("admin.applyCenter.newApplication");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const [moduleKey, setModuleKey] = useState(modules.at(0)?.moduleKey ?? "");
  const forms =
    modules.find((module) => module.moduleKey === moduleKey)?.forms ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const formKey = picked ?? forms.at(0)?.key ?? "";
  const createRoute =
    moduleKey === ""
      ? null
      : routeOf(formModulePageKey(moduleKey, "create-page"));

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={createRoute === null || formKey === ""}
            onClick={() => {
              onClose();
              void navigate(`${createRoute ?? ""}/${formKey}`);
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <SelectField
          label={t("module")}
          value={moduleKey}
          size="small"
          options={modules.map((module) => ({
            value: module.moduleKey,
            label: module.moduleName ?? module.moduleKey,
          }))}
          onChange={(next) => {
            setModuleKey(next);
            setPicked(null);
          }}
        />
        <SelectField
          label={t("form")}
          value={formKey}
          size="small"
          options={forms.map((form) => ({ value: form.key, label: form.name }))}
          onChange={setPicked}
        />
        {moduleKey !== "" && createRoute === null && (
          <Alert severity="warning">{t("noCreatePage")}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
