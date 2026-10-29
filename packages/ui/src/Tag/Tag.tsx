"use client";

import MuiChip, { type ChipProps as MuiChipProps } from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";

import { CloseIcon } from "../icons/CloseIcon";
import { mergeSx } from "../theme/sx";
import { type TagPaletteKey, tagPalettes } from "../theme/tag-palettes";
import { type TagTone, tagToneStyles } from "./tag-tones";

export type { TagTone } from "./tag-tones";

export interface TagProps extends Omit<
  MuiChipProps,
  "color" | "size" | "variant"
> {
  /** 色調(Figma Draft/Tag 76:722 的 Tone 變體軸);預設 grey。給了 `palette` 時不看它。 */
  tone?: TagTone;
  /**
   * 分類標籤的色票(`tagPalettes` 的代號,例:欄位選項的顏色);給了就以那一組的底色與文字色畫,
   * 取代 `tone`。深色模式換成深色那一組;可點時 hover / focus 只加一圈文字色外框。
   */
  palette?: TagPaletteKey;
}

/** 色票標籤的顏色:淺色一組、深色以 `theme.applyStyles("dark")` 換(和 theme 的 colorSchemes 同一個切換點,STYLE-04)。 */
const paletteSx = (key: TagPaletteKey): SxProps<Theme> => {
  const { light, dark } = tagPalettes[key];
  return (theme) => ({
    bgcolor: light.bg,
    color: light.text,
    // 可點的標籤:hover / focus 維持同一組顏色,只加一圈文字色外框(不換成別的顏色)
    "&.MuiChip-clickable:hover, &.MuiChip-clickable.Mui-focusVisible": {
      bgcolor: light.bg,
      boxShadow: `0 0 0 2px ${light.text}`,
    },
    ...theme.applyStyles("dark", {
      bgcolor: dark.bg,
      color: dark.text,
      "&.MuiChip-clickable:hover, &.MuiChip-clickable.Mui-focusVisible": {
        bgcolor: dark.bg,
        boxShadow: `0 0 0 2px ${dark.text}`,
      },
    }),
  });
};

/**
 * 狀態 / 分類標籤(啟用、停用、系統內建、群組、隱藏頁、+N…;分類色以 `palette` 指定)。
 * Figma Components / Tag 76:711 的 Draft/Tag 76:722:全圓角膠囊、左右 8 上下 2、11px SemiBold。
 * 傳 `onDelete` 就變成可關閉的標籤(關閉圖示用 ui 自己的 `CloseIcon`)。
 */
export const Tag = ({
  tone = "grey",
  palette,
  sx,
  onDelete,
  ...rest
}: TagProps) => (
  <MuiChip
    size="small"
    onDelete={onDelete}
    deleteIcon={<CloseIcon />}
    {...(palette === undefined ? {} : { "data-palette": palette })}
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
        ...(palette === undefined ? tagToneStyles[tone] : {}),
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
      palette === undefined ? undefined : paletteSx(palette),
      sx,
    )}
    {...rest}
  />
);
