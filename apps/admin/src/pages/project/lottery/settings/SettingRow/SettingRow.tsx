import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type LotterySettingItem,
  type SettingTranslate,
  settingParentText,
  settingSourceText,
  settingValueText,
} from "../setting-display";

export interface SettingRowProps {
  item: LotterySettingItem;
  isTenantTop: boolean;
  canEdit: boolean;
  isPending: boolean;
  /** 分店實際的盤點制度(只有盤點制度那一列、分店才有) */
  storeMode: string | null;
  /** [變更紀錄](只有分店的盤點制度那一列) */
  onHistory?: () => void;
  /** [取消轉換](轉換中、有權限時) */
  onCancelConversion?: () => void;
  onOpen: () => void;
  onRestore: () => void;
}

/**
 * 設定頁的一列(照排班規則的 `RuleRow`;Figma CS-50a):名稱 | 生效值(自訂時下方灰字「上層:…」)| 來源 |
 * [變更紀錄] | [自訂] / [還原](轉換中改成 [取消轉換])。電腦 / 平板一列橫排;手機名稱一行、下方灰字「值 · 來源」。
 * 點整列打開編輯對話框。
 */
export const SettingRow = ({
  item,
  isTenantTop,
  canEdit,
  isPending,
  storeMode,
  onHistory,
  onCancelConversion,
  onOpen,
  onRestore,
}: SettingRowProps) => {
  const t = useTranslations("admin.lotterySettings");
  const translate: SettingTranslate = (key, values) => t(key, values);
  const isOwn = item.effective.source === "own";
  const label = t(`labels.${item.key}`);
  const value = settingValueText(translate, item, item.effective, storeMode);
  const source = settingSourceText(translate, item.effective, isTenantTop);

  let action = null;
  if (onCancelConversion !== undefined) {
    action = (
      <Button
        variant="outlined"
        size="small"
        disabled={isPending}
        onClick={(event) => {
          event.stopPropagation();
          onCancelConversion();
        }}
      >
        {t("cancelConversion")}
      </Button>
    );
  } else if (canEdit) {
    action = (
      <Button
        variant="text"
        size="small"
        disabled={isPending}
        onClick={(event) => {
          event.stopPropagation();
          if (isOwn) {
            onRestore();
          } else {
            onOpen();
          }
        }}
      >
        {isOwn ? t("restore") : t("customize")}
      </Button>
    );
  }

  return (
    <Box
      data-setting-key={item.key}
      onClick={onOpen}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr auto",
          sm: "minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1fr) 88px 96px",
        },
        alignItems: "start",
        columnGap: 2,
        rowGap: 0.5,
        px: 2,
        py: 1.5,
        cursor: "pointer",
        borderBottom: 1,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ display: { sm: "none" } }}
        >
          {value} · {source}
        </Typography>
      </Stack>
      <Stack sx={{ display: { xs: "none", sm: "flex" }, minWidth: 0 }}>
        <Typography variant="body2">{value}</Typography>
        {item.parent && (
          <Typography variant="caption" color="textSecondary">
            {settingParentText(translate, item, item.parent)}
          </Typography>
        )}
      </Stack>
      <Typography
        variant="body2"
        color={isOwn ? "primary" : "textSecondary"}
        sx={{ display: { xs: "none", sm: "block" } }}
      >
        {source}
      </Typography>
      <Box sx={{ display: { xs: "none", sm: "block" } }}>
        {onHistory !== undefined && (
          <Button
            variant="text"
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onHistory();
            }}
          >
            {t("history")}
          </Button>
        )}
      </Box>
      <Box sx={{ textAlign: "right" }}>{action}</Box>
    </Box>
  );
};
