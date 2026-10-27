"use client";

import MuiBox from "@mui/material/Box";
import MuiStack from "@mui/material/Stack";

import { Typography } from "../Typography/Typography";

export interface UploadFieldPreviewProps {
  /** 這次選的檔案(檔名與大小取自它);顯示既有圖片時為 null */
  file: File | null;
  /** 圖片檔的預覽網址;非圖片或環境不支援時為 null,改顯示佔位方塊 */
  previewUrl: string | null;
  /** 顯示成「24 KB」這類人類可讀的大小 */
  formatSize: (bytes: number) => string;
  /** `file` 為 null(顯示既有圖片)時的說明文字 */
  fallbackLabel: string;
}

/** 已選檔案的預覽列(Figma Draft/UploadField State=Preview;`UploadField` 專用子元件)。 */
export const UploadFieldPreview = ({
  file,
  previewUrl,
  formatSize,
  fallbackLabel,
}: UploadFieldPreviewProps) => (
  <MuiStack
    direction="row"
    spacing={1.5}
    sx={{ alignItems: "center", flex: 1, minWidth: 0 }}
  >
    <MuiBox
      component={previewUrl === null ? "div" : "img"}
      src={previewUrl ?? undefined}
      alt=""
      sx={{
        width: (theme) => theme.spacing(5),
        height: (theme) => theme.spacing(5),
        flexShrink: 0,
        borderRadius: 1,
        objectFit: "cover",
        backgroundColor: "action.disabledBackground",
      }}
    />
    <MuiStack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography variant="body2" noWrap>
        {file === null ? fallbackLabel : file.name}
      </Typography>
      {file !== null && (
        <Typography variant="caption" color="textSecondary">
          {formatSize(file.size)}
        </Typography>
      )}
    </MuiStack>
  </MuiStack>
);
