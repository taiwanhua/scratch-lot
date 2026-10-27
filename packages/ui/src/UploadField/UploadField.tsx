"use client";

import MuiBox from "@mui/material/Box";
import MuiStack from "@mui/material/Stack";
import { type SxProps, type Theme, styled } from "@mui/material/styles";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../Button/Button";
import { Typography } from "../Typography/Typography";
import { UploadFieldPreview } from "./UploadFieldPreview";

export type UploadFieldErrorCode = "INVALID_TYPE" | "FILE_TOO_LARGE";

export interface UploadFieldError {
  code: UploadFieldErrorCode;
  /** 已翻成繁中的原因,元件本身也會顯示這段 */
  message: string;
  /** 被拒絕的檔案,供呼叫端記錄 */
  file: File;
}

export interface UploadFieldProps {
  /** 欄位標題(Figma Label 屬性) */
  label?: string;
  /** 空狀態下方的說明,如「PNG / JPG,建議正方形,2MB 以內」 */
  hint?: ReactNode;
  /** 受控值;不傳則由元件自行保存所選檔案 */
  value?: File | null;
  /**
   * 已經存在的圖片網址(編輯情境:組織現有的商標)。還沒選新檔之前就顯示它的預覽,
   * 選了新檔即被新檔的預覽取代,按「移除」則一併清掉、回到空狀態。
   */
  initialPreviewUrl?: string | null;
  /** `initialPreviewUrl` 的預覽說明文字(既有圖片沒有檔名與大小可顯示) */
  initialPreviewLabel?: string;
  /** 選到或清除檔案時觸發;清除時給 null */
  onChange?: (file: File | null) => void;
  /** 允許的型別:MIME(`image/png`)、萬用 MIME(`image/*`)或副檔名(`.png`) */
  accept?: readonly string[];
  /** 大小上限(bytes);超過即拒絕 */
  maxSize?: number;
  /** 檔案被拒絕時觸發(型別或大小不符) */
  onError?: (error: UploadFieldError) => void;
  isDisabled?: boolean;
  sx?: SxProps<Theme>;
}

/** 根容器固定佔滿寬度;呼叫端的 `sx` 疊在其上 */
const UploadFieldRoot = styled(MuiStack)({ width: "100%" });

const visuallyHiddenInputSx: SxProps<Theme> = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  opacity: 0,
};

const KILOBYTE = 1024;

/** bytes → 「24 KB」/「1.5 MB」 */
const formatSize = (bytes: number): string => {
  if (bytes < KILOBYTE) {
    return `${String(bytes)} B`;
  }
  const kilobytes = bytes / KILOBYTE;
  if (kilobytes < KILOBYTE) {
    return `${String(Math.round(kilobytes))} KB`;
  }
  return `${(kilobytes / KILOBYTE).toFixed(1)} MB`;
};

/** 檔案是否落在 `accept` 清單內;沒給 accept 就全收 */
const isTypeAccepted = (file: File, accept?: readonly string[]): boolean => {
  if (accept === undefined || accept.length === 0) {
    return true;
  }
  const fileType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();
  return accept.some((rawPattern) => {
    const pattern = rawPattern.trim().toLowerCase();
    if (pattern.startsWith(".")) {
      return fileName.endsWith(pattern);
    }
    if (pattern.endsWith("/*")) {
      return fileType.startsWith(pattern.slice(0, -1));
    }
    return fileType === pattern;
  });
};

/**
 * 圖片 / 檔案上傳欄位(Figma Draft/UploadField 121:2):點擊或拖放選檔、預覽、清除,
 * 型別與大小不符時拒絕並回報錯誤。**不含上傳邏輯** — 只把 `File` 交給呼叫端,
 * 由呼叫端取簽名網址後自行上傳。
 */
export const UploadField = ({
  label,
  hint,
  value,
  initialPreviewUrl = null,
  initialPreviewLabel = "目前的圖片",
  onChange,
  accept,
  maxSize,
  onError,
  isDisabled = false,
  sx,
}: UploadFieldProps) => {
  const [internalFile, setInternalFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  /** 按過「移除」之後就不再退回既有圖片(移除一律回到空狀態) */
  const [isInitialCleared, setIsInitialCleared] = useState(false);

  const file = value === undefined ? internalFile : value;
  /** 還沒選新檔、也還沒被移除時,顯示的是既有圖片 */
  const isShowingInitial =
    file === null &&
    !isInitialCleared &&
    initialPreviewUrl !== null &&
    initialPreviewUrl !== "";

  const filePreviewUrl = useMemo(() => {
    if (
      file === null ||
      !file.type.startsWith("image/") ||
      typeof URL.createObjectURL !== "function"
    ) {
      return null;
    }
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(
    () => () => {
      if (filePreviewUrl !== null) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    },
    [filePreviewUrl],
  );

  /** 預覽的來源:選了新檔就是新檔,否則是既有圖片(都沒有就沒有預覽) */
  const previewUrl = isShowingInitial ? initialPreviewUrl : filePreviewUrl;

  const reject = (rejected: File, code: UploadFieldErrorCode) => {
    const message =
      code === "INVALID_TYPE"
        ? "檔案格式不支援"
        : `檔案大小超過上限(${formatSize(maxSize ?? 0)})`;
    setErrorMessage(message);
    onError?.({ code, message, file: rejected });
  };

  const acceptFile = (candidate: File) => {
    if (!isTypeAccepted(candidate, accept)) {
      reject(candidate, "INVALID_TYPE");
      return;
    }
    if (maxSize !== undefined && candidate.size > maxSize) {
      reject(candidate, "FILE_TOO_LARGE");
      return;
    }
    setErrorMessage(null);
    setInternalFile(candidate);
    onChange?.(candidate);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // 同一個檔案連選兩次也要觸發 change
    event.target.value = "";
    if (picked !== undefined) {
      acceptFile(picked);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (isDisabled) {
      return;
    }
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) {
      acceptFile(dropped);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleClear = () => {
    setErrorMessage(null);
    setInternalFile(null);
    setIsInitialCleared(true);
    onChange?.(null);
  };

  return (
    <UploadFieldRoot spacing={0.75} sx={sx} aria-disabled={isDisabled}>
      {label !== undefined && (
        <Typography variant="caption" color="textSecondary">
          {label}
        </Typography>
      )}
      <MuiBox
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => {
          setIsDragOver(false);
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          p: 2,
          borderRadius: 1.5,
          border: "1px dashed",
          borderColor: isDragOver ? "primary.main" : "divider",
          backgroundColor: isDragOver ? "action.hover" : "background.paper",
          opacity: isDisabled ? 0.5 : 1,
        }}
      >
        <MuiBox
          component="label"
          sx={{
            display: "flex",
            flex: 1,
            minWidth: 0,
            alignItems: "center",
            justifyContent:
              file === null && !isShowingInitial ? "center" : "flex-start",
            cursor: isDisabled ? "not-allowed" : "pointer",
          }}
        >
          <MuiBox
            component="input"
            type="file"
            accept={accept?.join(",")}
            disabled={isDisabled}
            onChange={handleInputChange}
            aria-label={label ?? "選擇檔案"}
            sx={visuallyHiddenInputSx}
          />
          {file === null && !isShowingInitial ? (
            <MuiStack spacing={0.5} sx={{ alignItems: "center" }}>
              <Typography variant="body2">點擊或拖曳圖片至此</Typography>
              {hint !== undefined && (
                <Typography variant="caption" color="textSecondary">
                  {hint}
                </Typography>
              )}
            </MuiStack>
          ) : (
            <UploadFieldPreview
              file={file}
              previewUrl={previewUrl}
              formatSize={formatSize}
              fallbackLabel={initialPreviewLabel}
            />
          )}
        </MuiBox>
        {(file !== null || isShowingInitial) && (
          <Button
            variant="text"
            size="small"
            disabled={isDisabled}
            onClick={handleClear}
          >
            移除
          </Button>
        )}
      </MuiBox>
      {errorMessage !== null && (
        <Typography variant="caption" color="error" role="alert">
          {errorMessage}
        </Typography>
      )}
    </UploadFieldRoot>
  );
};
