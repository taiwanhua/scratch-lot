import { useTranslations } from "use-intl";

import { UploadField } from "@repo/ui/upload-field";

import { LOGO_ACCEPT, LOGO_MAX_SIZE } from "./org-manager-types";

export interface OrgLogoFieldProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** 編輯情境:組織現有的商標(`org.logoUrl`),彈窗一開就看得到 */
  initialPreviewUrl?: string | null;
  isDisabled: boolean;
}

/**
 * 商標上傳欄(Figma Draft/UploadField 121:1508 / 121:1514;編輯組織與開通租戶共用)。
 * 只負責「選一個檔案」— 真正的上傳在送出時由 `useLogoUpload` 走 ADR-0010 的三步。
 * 型別與大小的上限與 api 同一份(`org-manager-types.ts`),先在瀏覽器擋掉明顯不合的檔案。
 */
export const OrgLogoField = ({
  file,
  onFileChange,
  initialPreviewUrl = null,
  isDisabled,
}: OrgLogoFieldProps) => {
  const t = useTranslations("admin.orgManager.form");

  return (
    <UploadField
      label={t("logo")}
      hint={t("logoHint")}
      value={file}
      initialPreviewUrl={initialPreviewUrl}
      initialPreviewLabel={t("logoCurrent")}
      onChange={onFileChange}
      accept={LOGO_ACCEPT}
      maxSize={LOGO_MAX_SIZE}
      isDisabled={isDisabled}
    />
  );
};
