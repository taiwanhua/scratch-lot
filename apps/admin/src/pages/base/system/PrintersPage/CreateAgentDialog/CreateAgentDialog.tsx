import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CreatePrintAgentMutation,
  useCreatePrintAgentMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { PairingInfo } from "../PairingInfo/PairingInfo";
import { printersErrorOf } from "../printers-error";
import {
  type PrintersLookups,
  useInvalidatePrinters,
} from "../usePrintersLookups";

type Pairing = CreatePrintAgentMutation["createPrintAgent"];

export interface CreateAgentDialogProps {
  lookups: PrintersLookups;
  onClose: () => void;
}

/**
 * [新增代理程式](Figma BS-10b 289:92651;底座規格「配對」第 1 點):選分店、填名稱 → [建立] →
 * 同一個對話框顯示伺服器網址與 8 碼配對碼(10 分鐘有效,只顯示這一次)→ [完成]。
 * 新增彈窗不進網址(REACT-14:還沒有那一筆,內容全是未存輸入;配對碼也不該出現在網址上)。
 */
export const CreateAgentDialog = ({
  lookups,
  onClose,
}: CreateAgentDialogProps) => {
  const t = useTranslations("admin.printers.createAgent");
  const tErrors = useTranslations("admin.printers.errors");
  const { session } = useSession();
  const invalidate = useInvalidatePrinters();
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [isTouched, setIsTouched] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  const create = useCreatePrintAgentMutation(
    session.client,
    useMutationFeedback<CreatePrintAgentMutation>({
      success: t("success"),
      error: (error) => tErrors(printersErrorOf(error).code),
      onSuccess: (payload) => {
        setPairing(payload.createPrintAgent);
        void invalidate();
      },
    }),
  );

  const isOrgMissing = isTouched && orgId === "";
  const isNameMissing = isTouched && name.trim() === "";

  const submit = () => {
    setIsTouched(true);
    if (orgId === "" || name.trim() === "") {
      return;
    }
    create.mutate({ input: { orgId, name: name.trim() } });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        pairing === null ? (
          <>
            <Button variant="text" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button disabled={create.isPending} onClick={submit}>
              {t("submit")}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("done")}</Button>
        )
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <SelectField
          label={t("org")}
          value={orgId}
          options={lookups.orgs.map((org) => ({
            value: org.id,
            label: org.path,
          }))}
          required
          fullWidth
          disabled={pairing !== null}
          error={isOrgMissing}
          helperText={isOrgMissing ? t("required") : undefined}
          onChange={setOrgId}
        />
        <TextField
          label={t("name")}
          value={name}
          required
          fullWidth
          disabled={pairing !== null}
          error={isNameMissing}
          helperText={isNameMissing ? t("required") : t("nameHint")}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {pairing !== null && (
          <PairingInfo
            pairingCode={pairing.pairingCode}
            expiresAt={pairing.pairingExpiresAt}
          />
        )}
      </Stack>
    </Dialog>
  );
};
