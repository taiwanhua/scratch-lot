import { useState } from "react";
import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../store-text";
import { type GroupCount, groupDiffOf } from "./stocktake-count-model";
import { type SheetCountGroup } from "./stocktake-model";

export interface StocktakeCountGroupPanelProps {
  group: SheetCountGroup;
  cashPointName: string;
  count: GroupCount | undefined;
  /** 這一組全店重刷中(之後的全店重刷;現在一律 false) */
  onConfirm: (presentCount: number) => void;
  onRecount: () => void;
  /** [上一組]:第一組 = null(停用、不隱藏;張數店規格 13.3) */
  onPrev: (() => void) | null;
  /** [下一組];全部數完 = [盤完,前往差異核對] */
  onNext: () => void;
  nextIsReview: boolean;
}

const isWholeNumber = (text: string): boolean => /^\d+$/.test(text.trim());

/**
 * 張數盤點頁右欄:選中的一組(張數店規格 8.1、13.1;Figma CS-09a / 09b):遊戲名 · 收銀點、單價與本數、
 * 「實際剩幾張」輸入框 → [確定] 後才顯示「系統 12 · 實際 11 · 少 1 張」(數之前不顯示系統數字,避免沒數就照填),
 * 可按 [重數] 重新輸入(盤點單記下每次輸入);[上一組] [下一組] 照 13.3 的按鈕規則。
 */
export const StocktakeCountGroupPanel = ({
  group,
  cashPointName,
  count,
  onConfirm,
  onRecount,
  onPrev,
  onNext,
  nextIsReview,
}: StocktakeCountGroupPanelProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.count");
  const [input, setInput] = useState("");
  const confirmed = count?.presentCount != null;
  const diff = groupDiffOf(group, count);
  const system = count?.systemShown ?? group.unsoldCount;
  const diffText = (() => {
    if (diff === null || diff === 0) {
      return t("diffNone");
    }
    return diff < 0
      ? t("diffShort", { count: -diff })
      : t("diffOver", { count: diff });
  })();
  const confirm = () => {
    if (isWholeNumber(input)) {
      onConfirm(Number(input.trim()));
    }
  };
  const books = group.bookNos.map((bookNo) => displayBookNo(bookNo));

  return (
    <Card sx={{ px: { xs: 1.5, sm: 3 }, py: 2.5 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "baseline", flexWrap: "wrap" }}
        >
          <Typography variant="subtitle1" component="h2">
            {t("title", {
              game: `${group.gameCode} ${group.gameName}`,
              cashPoint: cashPointName,
            })}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {t("meta", {
              price: moneyText(group.unitPrice),
              count: books.length,
              books: books.join("、"),
            })}
          </Typography>
        </Stack>
        <Typography variant="body2" color="textSecondary">
          {t("hint")}
        </Typography>
        <TextField
          label={t("present")}
          size="small"
          value={confirmed ? String(count.presentCount) : input}
          disabled={confirmed}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              confirm();
            }
          }}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          fullWidth
        />
        {confirmed ? (
          <Typography
            variant="subtitle1"
            sx={{
              color: diff === 0 ? "text.secondary" : "warning.dark",
            }}
          >
            {t("figures", {
              system,
              present: count.presentCount ?? 0,
              diff: diffText,
            })}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Button
            variant="outlined"
            disabled={onPrev === null}
            onClick={() => {
              onPrev?.();
            }}
          >
            {t("prev")}
          </Button>
          <span style={{ flex: 1 }} />
          {confirmed ? (
            <>
              <Button
                variant="outlined"
                onClick={() => {
                  setInput("");
                  onRecount();
                }}
              >
                {t("recount")}
              </Button>
              <Button variant="contained" onClick={onNext}>
                {nextIsReview ? t("finish") : t("next")}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              disabled={!isWholeNumber(input)}
              onClick={confirm}
            >
              {t("confirm")}
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
};
