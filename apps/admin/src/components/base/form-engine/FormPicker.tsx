import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";

import type { ModuleFormSummary } from "@/hooks/base/useModuleForms";

export interface FormPickerProps {
  forms: readonly ModuleFormSummary[];
  onPick: (form: ModuleFormSummary) => void;
  onClose: () => void;
}

/**
 * 多張表單時的選單(`<FormPicker>`;此刻可新增的表單一張 → 直接進、多張 → 先選)。
 * 清單由呼叫端給 `useModuleForms` 的 `creatableForms`(已扣掉沒有新增權限的),這裡不再過濾。
 */
export const FormPicker = ({ forms, onPick, onClose }: FormPickerProps) => {
  const t = useTranslations("admin.formEngine.picker");

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <Button variant="text" onClick={onClose}>
          {t("cancel")}
        </Button>
      }
    >
      <List aria-label={t("listLabel")}>
        {forms.map((form) => (
          <ListItemButton
            key={form.key}
            onClick={() => {
              onPick(form);
            }}
          >
            <ListItemText
              primary={form.name}
              secondary={t("version", { version: form.currentVersion })}
            />
          </ListItemButton>
        ))}
      </List>
    </Dialog>
  );
};
