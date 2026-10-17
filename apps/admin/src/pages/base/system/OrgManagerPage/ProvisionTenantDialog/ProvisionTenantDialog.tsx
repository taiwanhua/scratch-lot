import { useTranslations } from "use-intl";

import { useTenantModuleOptionsQuery } from "@repo/graphql";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";

import { useSession } from "@/hooks/base/useSession";

import { ProvisionTenantForm } from "./ProvisionTenantForm";
import { toModuleRows } from "./module-selection";

export interface ProvisionTenantDialogProps {
  onClose: () => void;
  onProvisioned: (orgId: string) => void;
}

/**
 * 開通租戶彈窗的外層:先把模組選項取回來,取到才把表單掛上去 —
 * 表單的初始勾選是「全勾」,那需要清單先在手上(初始值進 `useState`、不靠 effect 補,REACT-06)。
 */
export const ProvisionTenantDialog = ({
  onClose,
  onProvisioned,
}: ProvisionTenantDialogProps) => {
  const t = useTranslations("admin.orgManager.provision");
  const { session } = useSession();
  const options = useTenantModuleOptionsQuery(session.client);

  if (options.data === undefined) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm" title={t("title")}>
        <Stack sx={{ alignItems: "center", py: 4 }}>
          <CircularProgress aria-label={t("title")} />
        </Stack>
      </Dialog>
    );
  }

  return (
    <ProvisionTenantForm
      rows={toModuleRows(options.data.tenantModuleOptions)}
      onClose={onClose}
      onProvisioned={onProvisioned}
    />
  );
};
