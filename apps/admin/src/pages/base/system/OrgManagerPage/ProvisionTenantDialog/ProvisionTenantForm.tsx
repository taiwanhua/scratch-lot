import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidOrgSlug } from "@repo/domain/form-keys";
import {
  type ProvisionTenantMutation,
  useProvisionTenantMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { OrgLogoField } from "../OrgLogoField";
import {
  type OrgManagerErrorCode,
  orgManagerErrorOf,
} from "../org-manager-error";
import { useLogoUpload } from "../useLogoUpload";
import { ModuleCheckList } from "./ModuleCheckList";
import { type ModuleRow, moduleKeysOf, toggleModule } from "./module-selection";

export interface ProvisionTenantFormProps {
  rows: readonly ModuleRow[];
  onClose: () => void;
  onProvisioned: (orgId: string) => void;
}

/**
 * 開通租戶表單(Figma 88:147)。送出後由 api 一次完成 ADR-0009 的四步
 * (建租戶 Org → 複製「租戶管理員」角色副本、只綁勾選的模組 → 建首任管理員並綁定 → 寄啟用信)
 * 並設 `ownerUserId`;**不設初始密碼**,由啟用信自行設定。
 *
 * 帳號預設帶入 Email:沒有動過帳號欄時,顯示與送出的都是 Email 的當下值 —
 * 用「碰過沒有」在 render 期推導,而不是在 effect 裡把 Email 抄進帳號(REACT-06)。
 *
 * 租戶短碼(`orgs.slug`)格式與 api 同一條(`@repo/domain/form` 的 `isValidOrgSlug`):
 * 打錯當下就標在欄位上、不能送出;格式對但已被別的租戶用,由 api 回 `VALIDATION_FAILED`
 * (`fields` 含 `slug`)再標回欄位。
 */
export const ProvisionTenantForm = ({
  rows,
  onClose,
  onProvisioned,
}: ProvisionTenantFormProps) => {
  const t = useTranslations("admin.orgManager.provision");
  const tForm = useTranslations("admin.orgManager.form");
  const tErrors = useTranslations("admin.orgManager.errors");
  const tFeedback = useTranslations("admin.orgManager.feedback");
  const { session } = useSession();
  const { uploadLogo, isUploading } = useLogoUpload();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /** api 判定短碼已被用(格式在前端就擋掉了,後端擋回來的只剩撞名) */
  const [isSlugTaken, setIsSlugTaken] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [typedAccount, setTypedAccount] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(rows.map((row) => row.option.id)),
  );
  const [errorCode, setErrorCode] = useState<OrgManagerErrorCode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 一次「開通」= 商標上傳 + `provisionTenant`,所以回饋由整段 try / catch 自己報一次
   * (多步流程的做法),而不是掛在 mutation 的 options 上 ——
   * 掛上去的話上傳失敗那條路徑就沒有提示。
   */
  const feedback = useMutationFeedback<ProvisionTenantMutation>({
    // 啟用信在交易提交後才寄;沒寄出時開通照樣成立,改提示首任管理員走「忘記密碼」
    success: (data) =>
      data.provisionTenant.activationMailSent
        ? tFeedback("provisionSuccess")
        : tFeedback("provisionMailNotSent"),
    error: (error) => tErrors(orgManagerErrorOf(error).code),
  });
  const provisionTenant = useProvisionTenantMutation(session.client);

  const adminAccount = typedAccount ?? adminEmail;
  const isBusy = isSubmitting || isUploading;
  const trimmedSlug = slug.trim();
  const isSlugMalformed = trimmedSlug !== "" && !isValidOrgSlug(trimmedSlug);
  const slugTakenOrHint = isSlugTaken ? t("slugTaken") : t("slugHint");
  const slugHelper = isSlugMalformed ? t("slugInvalid") : slugTakenOrHint;
  const isValid =
    name.trim() !== "" &&
    isValidOrgSlug(trimmedSlug) &&
    adminEmail.trim() !== "" &&
    adminAccount.trim() !== "" &&
    selectedIds.size > 0;

  const submit = async () => {
    setErrorCode(null);
    setIsSubmitting(true);
    try {
      const logoPath = await uploadLogo(logoFile);
      const payload = await provisionTenant.mutateAsync({
        input: {
          name: name.trim(),
          slug: trimmedSlug,
          adminEmail: adminEmail.trim(),
          adminAccount: adminAccount.trim(),
          logoPath,
          moduleKeys: moduleKeysOf(selectedIds, rows),
        },
      });
      feedback.onSuccess(payload);
      onProvisioned(payload.provisionTenant.org.id);
    } catch (error) {
      feedback.onError(error);
      const parsed = orgManagerErrorOf(error);
      setErrorCode(parsed.code);
      setIsSlugTaken(
        parsed.code === "VALIDATION_FAILED" &&
          (parsed.fields ?? []).includes("slug"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {tForm("cancel")}
          </Button>
          <Button
            disabled={!isValid || isBusy}
            onClick={() => {
              void submit();
            }}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.25}>
        <TextField
          label={t("tenantName")}
          value={name}
          required
          fullWidth
          disabled={isBusy}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField
          label={t("tenantSlug")}
          value={slug}
          required
          fullWidth
          disabled={isBusy}
          error={isSlugMalformed || isSlugTaken}
          helperText={slugHelper}
          onChange={(event) => {
            setSlug(event.target.value);
            setIsSlugTaken(false);
          }}
        />
        <TextField
          label={t("adminEmail")}
          value={adminEmail}
          type="email"
          required
          fullWidth
          disabled={isBusy}
          onChange={(event) => {
            setAdminEmail(event.target.value);
          }}
        />
        <TextField
          label={t("adminAccount")}
          value={adminAccount}
          required
          fullWidth
          disabled={isBusy}
          helperText={t("adminAccountHint")}
          onChange={(event) => {
            setTypedAccount(event.target.value);
          }}
        />
        <OrgLogoField
          file={logoFile}
          onFileChange={setLogoFile}
          isDisabled={isBusy}
        />
        <ModuleCheckList
          rows={rows}
          selectedIds={selectedIds}
          isDisabled={isBusy}
          onToggle={(id, isChecked) => {
            setSelectedIds(toggleModule(selectedIds, rows, id, isChecked));
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {t("note")}
        </Typography>
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
