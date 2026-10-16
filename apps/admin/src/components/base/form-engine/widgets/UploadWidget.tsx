import { useState } from "react";
import { useTranslations } from "use-intl";

import { uploadLimitsOf } from "@repo/domain/form";
import { UploadPurpose, useCreateUploadUrlMutation } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";
import { UploadField } from "@repo/ui/upload-field";

import { useSession } from "@/hooks/base/useSession";
import { acceptedExtensionsText } from "@/lib/base/form-engine/upload-types";
import { uploadNameOf } from "@/lib/base/form-engine/value-text";

import type { WidgetProps } from "./widget-types";

const BYTES_PER_MB = 1024 * 1024;

/**
 * 上傳欄(`upload` → `upload`;ADR-0010 的三步:要簽名上傳票 → 瀏覽器直傳 bucket → 存
 * `{ path, name, size, contentType }`)。選了檔就上傳,存值換成新檔;按「移除」存 null。
 * 檔型 / 大小依欄位設定(`widget.accept` / `maxSizeMb`,只能收窄平台上限;`uploadLimitsOf`),
 * 不符的檔在選檔時就擋下並提示;api 存草稿與送出時再驗一次。
 * 下載走 `formSubmissionAttachmentUrl`(唯讀檢視的 `onDownload`;看得到這一欄才簽)。
 */
export const UploadWidget = ({
  field,
  value,
  onChange,
  isDisabled,
  isReadOnly = false,
  isDesign,
  helperText,
  hasError,
  onDownload,
}: WidgetProps) => {
  const t = useTranslations("admin.formEngine.widgets");
  const tRenderer = useTranslations("admin.formEngine.renderer");
  const { session } = useSession();
  const createUploadUrl = useCreateUploadUrlMutation(session.client);
  const [isUploading, setIsUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rejected, setRejected] = useState(false);
  const name = uploadNameOf(value);
  const limits = uploadLimitsOf(field);
  const limitText = {
    types: acceptedExtensionsText(field),
    size: limits.maxBytes / BYTES_PER_MB,
  };

  const upload = async (file: File) => {
    setIsUploading(true);
    setFailed(false);
    setRejected(false);
    try {
      const { createUploadUrl: ticket } = await createUploadUrl.mutateAsync({
        input: {
          purpose: UploadPurpose.FormAttachment,
          contentType: file.type,
          size: file.size,
        },
      });
      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Form upload failed: ${String(response.status)}`);
      }
      onChange({
        path: ticket.objectPath,
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
    } catch {
      setFailed(true);
    } finally {
      setIsUploading(false);
    }
  };

  if (isReadOnly) {
    // 唯讀檢視:標題 + 檔名;有 `onDownload`(看得到這一欄)就是下載按鈕,空值「—」
    return (
      <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2" color="text.secondary">
          {field.label}
        </Typography>
        {name !== "" && onDownload !== undefined ? (
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onDownload(field);
            }}
          >
            {name}
          </Button>
        ) : (
          <Typography variant="body2">
            {name === "" ? tRenderer("empty") : name}
          </Typography>
        )}
        {helperText !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {helperText}
          </Typography>
        )}
      </Stack>
    );
  }

  let note = helperText;
  if (rejected) {
    note = t("uploadRejected", limitText);
  } else if (failed) {
    note = t("uploadFailed");
  }

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary">
        {field.label}
      </Typography>
      {name === "" ? (
        <UploadField
          accept={limits.accept}
          maxSize={limits.maxBytes}
          isDisabled={isDisabled || isDesign || isUploading}
          hint={
            isUploading ? t("uploading") : t("uploadHintLimited", limitText)
          }
          onError={() => {
            setRejected(true);
          }}
          onChange={(file) => {
            if (file !== null) {
              void upload(file);
            }
          }}
        />
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2">{name}</Typography>
          {!isDisabled && (
            <Button
              variant="text"
              size="small"
              color="error"
              onClick={() => {
                onChange(null);
              }}
            >
              {t("removeFile")}
            </Button>
          )}
        </Stack>
      )}
      {note !== undefined && (
        <Typography
          variant="caption"
          color={hasError || failed || rejected ? "error" : "text.secondary"}
        >
          {note}
        </Typography>
      )}
    </Stack>
  );
};
