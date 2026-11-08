import { useState } from "react";
import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import type { LotteryInventoryBookDetailFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Menu, MenuItem } from "@repo/ui/menu";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../inventory-config";

export interface BookHeaderProps {
  detail: LotteryInventoryBookDetailFieldsFragment;
  /** 顯示 [整本尋回](有 `recover`、而且有自己能操作的待查 / 遺失張) */
  canRecoverAll: boolean;
  /** [標跳號](`abilities.canMarkSkips`:還有待標註) */
  onMarkSkips: () => void;
  /** [更正跳號](`abilities.canCorrectSkips`;張數店規格 7.10,兩種店共用) */
  onCorrectSkip: () => void;
  onRecoverAll: () => void;
}

/**
 * 本的詳情頁首(Figma IN-03、IN-03-3 / 3b):遊戲 · 本號、面額 · 張號、顯示狀態(`bookStates.*`,含已撤銷)、
 * [標跳號](`abilities.canMarkSkips`)、[更正跳號](`abilities.canCorrectSkips`;張數店規格 7.10);手機兩顆收成
 * 一顆 [跳號 ▾] 選單(避免標題列換行)。沒有未售、而且有待查 / 遺失時下方加狀態列「這本待查中 … [整本尋回]」
 * (Figma 125:1699)。
 */
export const BookHeader = ({
  detail,
  canRecoverAll,
  onMarkSkips,
  onCorrectSkip,
  onRecoverAll,
}: BookHeaderProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const temporal = useTemporalText();
  const isMobile = useBreakpointDown("sm");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { book, abilities, investigation } = detail;
  const skipActions = [
    ...(abilities.canMarkSkips
      ? [{ key: "mark", label: t("book.markSkips"), onClick: onMarkSkips }]
      : []),
    ...(abilities.canCorrectSkips
      ? [
          {
            key: "correct",
            label: t("book.correctSkip"),
            onClick: onCorrectSkip,
          },
        ]
      : []),
  ];
  const skipButtons =
    isMobile && skipActions.length > 1 ? (
      <>
        <Button
          variant="outlined"
          size="small"
          aria-haspopup="menu"
          onClick={(event) => {
            setMenuAnchor(event.currentTarget);
          }}
        >
          {t("book.skipMenu")}
        </Button>
        <Menu
          anchorEl={menuAnchor}
          open={menuAnchor !== null}
          onClose={() => {
            setMenuAnchor(null);
          }}
        >
          {skipActions.map((action) => (
            <MenuItem
              key={action.key}
              onClick={() => {
                setMenuAnchor(null);
                action.onClick();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
        </Menu>
      </>
    ) : (
      skipActions.map((action) => (
        <Button key={action.key} variant="outlined" onClick={action.onClick}>
          {action.label}
        </Button>
      ))
    );
  return (
    <>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ alignItems: { sm: "center" }, gap: 1 }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: "baseline", gap: 1.5, flex: 1, flexWrap: "wrap" }}
        >
          <Typography variant="h6" component="h1">
            {t("book.title", {
              game: `${book.gameCode} ${book.gameName}`,
              bookNo: displayBookNo(book.bookNo),
            })}
          </Typography>
          <Typography variant="body2">
            {t("book.subtitle", {
              price: moneyText(book.unitPrice),
              first: book.firstTicketNo,
              last: book.lastTicketNo,
            })}
            {/* 有未對號 → 逐本剩餘是估算(遊戲合計精確;張數店規格 13.2,Figma CS-20) */}
            {book.unmatchedCount > 0
              ? t("book.remainingEstimated", {
                  remaining: book.remainingCount,
                  unmatched: book.unmatchedCount,
                })
              : null}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <Tag
            tone={investigation == null ? "grey" : "warning"}
            label={t(`bookStates.${book.state}`)}
          />
          {skipButtons}
        </Stack>
      </Stack>

      {investigation == null ? null : (
        <Alert
          severity="warning"
          action={
            canRecoverAll ? (
              <Button onClick={onRecoverAll}>{t("book.recoverAll")}</Button>
            ) : undefined
          }
        >
          {t("book.investigation", {
            status: t(`ticketStatuses.${investigation.status}`),
            date: investigation.at
              ? temporal(investigation.at, "monthDay")
              : "",
            serial: investigation.refSerialNo ?? "",
            store: investigation.responsibleOrg?.name ?? t("stock.none"),
          })}
        </Alert>
      )}
    </>
  );
};
