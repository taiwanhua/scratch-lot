import { useId, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Popover } from "@repo/ui/popover";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import {
  TAG_PALETTE_KEYS,
  type TagPaletteKey,
} from "@/lib/project/tag-palettes";

export interface TagPaletteSelectProps {
  /** 目前的色票代號;`null` = 不設定 */
  value: TagPaletteKey | null;
  onChange: (value: TagPaletteKey | null) => void;
  /** 觸發標籤的無障礙名稱(例「「補貨」的顏色」);省略 = 「顏色」 */
  label?: string;
  disabled?: boolean;
}

/** 面板一列幾個標籤(Figma 289:88006:兩列各 5 個)。 */
const PER_ROW = 5;

const PALETTE_ROWS: readonly (readonly TagPaletteKey[])[] = Array.from(
  { length: Math.ceil(TAG_PALETTE_KEYS.length / PER_ROW) },
  (_, index) => TAG_PALETTE_KEYS.slice(index * PER_ROW, (index + 1) * PER_ROW),
);

/**
 * 色票選擇(規格 18.5:**只能從色票選,不能輸入色碼**;Figma BS-13 289:87534 / 色票面板 289:88006)。
 *
 * - 觸發:目前的色票標籤本身(沒有外框、沒有箭頭);沒有顏色時是文字按鈕「不設定」
 * - 面板:`@repo/ui` 的 Popover,標題「選擇顏色」、十組色票兩列各 5 個、下方「不設定」;選了就關
 */
export const TagPaletteSelect = ({
  value,
  onChange,
  label,
  disabled = false,
}: TagPaletteSelectProps) => {
  const t = useTranslations("admin.tagPalettes.select");
  const titleId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const isOpen = anchor !== null;

  const choose = (next: TagPaletteKey | null) => {
    setAnchor(null);
    if (next !== value) {
      onChange(next);
    }
  };

  const triggerAria = {
    "aria-label": label ?? t("label"),
    "aria-haspopup": "dialog" as const,
    "aria-expanded": isOpen,
  };

  return (
    <>
      {value === null ? (
        <Button
          variant="text"
          size="small"
          disabled={disabled}
          onClick={(event) => {
            setAnchor(event.currentTarget);
          }}
          {...triggerAria}
        >
          {t("none")}
        </Button>
      ) : (
        <TagPaletteChip
          paletteKey={value}
          disabled={disabled}
          onClick={(event) => {
            setAnchor(event.currentTarget);
          }}
          {...triggerAria}
        />
      )}
      <Popover
        open={isOpen}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { role: "dialog", "aria-labelledby": titleId } }}
      >
        {/* Figma 289:88006:內距左右 16、上下 12;標題、兩列色票、「不設定」由上而下 */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Stack spacing={1.5}>
            <Typography id={titleId} variant="subtitle2">
              {t("title")}
            </Typography>
            <Stack spacing={1}>
              {PALETTE_ROWS.map((row) => (
                <Stack key={row.join("-")} direction="row" spacing={1}>
                  {row.map((key) => (
                    <TagPaletteChip
                      key={key}
                      paletteKey={key}
                      aria-pressed={key === value}
                      onClick={() => {
                        choose(key);
                      }}
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
            <Box>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  choose(null);
                }}
              >
                {t("none")}
              </Button>
            </Box>
          </Stack>
        </Box>
      </Popover>
    </>
  );
};
