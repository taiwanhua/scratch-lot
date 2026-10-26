import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import type { LotteryInventoryBookDetailFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
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
  onRecoverAll: () => void;
}

/**
 * 本的詳情頁首(Figma IN-03):遊戲 · 本號、面額 · 張號、顯示狀態(`bookStates.*`,含已撤銷)、
 * [標跳號](`abilities.canMarkSkips`;更正標錯的跳號改在格子上選一對 [對調跳號…]);沒有未售、而且有待查 / 遺失時
 * 下方加狀態列「這本待查中 … [整本尋回]」(Figma 125:1699)。
 */
export const BookHeader = ({
  detail,
  canRecoverAll,
  onMarkSkips,
  onRecoverAll,
}: BookHeaderProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const temporal = useTemporalText();
  const { book, investigation } = detail;
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
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <Tag
            tone={investigation == null ? "grey" : "warning"}
            label={t(`bookStates.${book.state}`)}
          />
          {abilities.canMarkSkips ? (
            <Button variant="outlined" onClick={onMarkSkips}>
              {t("book.markSkips")}
            </Button>
          ) : null}
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
