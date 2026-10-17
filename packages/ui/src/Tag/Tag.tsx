"use client";

import MuiChip, { type ChipProps as MuiChipProps } from "@mui/material/Chip";

import { CloseIcon } from "../icons/CloseIcon";
import { mergeSx } from "../theme/sx";
import { type TagTone, tagToneStyles } from "./tag-tones";

export type { TagTone } from "./tag-tones";

export interface TagProps extends Omit<
  MuiChipProps,
  "color" | "size" | "variant"
> {
  /** 色調(Figma Draft/Tag 76:722 的 Tone 變體軸);預設 grey。 */
  tone?: TagTone;
}

/**
 * 狀態 / 分類標籤(啟用、停用、系統內建、群組、隱藏頁、+N…)。
 * Figma Components / Tag 76:711 的 Draft/Tag 76:722:全圓角膠囊、左右 8 上下 2、11px SemiBold。
 * 傳 `onDelete` 就變成可關閉的標籤(關閉圖示用 ui 自己的 `CloseIcon`)。
 */
export const Tag = ({ tone = "grey", sx, onDelete, ...rest }: TagProps) => (
  <MuiChip
    size="small"
    onDelete={onDelete}
    deleteIcon={<CloseIcon />}
    sx={mergeSx(
      {
        height: "auto",
        // 膠囊(Figma 的 999):與品牌無關的形狀值,不走 shape.borderRadius
        borderRadius: "999px",
        paddingInline: 1,
        paddingBlock: "2px",
        // Figma 指定 11px;theme.typography 的最小級是 caption 12px,故此處直寫
        fontSize: "0.6875rem",
        fontWeight: 600,
        ...tagToneStyles[tone],
        "& .MuiChip-label": { paddingInline: 0 },
        "& .MuiChip-deleteIcon": {
          fontSize: "0.75rem",
          marginRight: 0,
          marginLeft: 0.5,
          color: "inherit",
          opacity: 0.6,
          "&:hover": { color: "inherit", opacity: 1 },
        },
      },
      sx,
    )}
    {...rest}
  />
);
