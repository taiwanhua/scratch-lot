import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type ParsedTicketInput,
  displayBookNo,
  parseTicketInput,
} from "@repo/domain/project/lottery";
import {
  type LotteryTicketLookupItemFieldsFragment,
  useLotteryTicketLookupQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useScanner } from "@/hooks/project/useScanner/useScanner";

import { INVENTORY_LOOKUP_SCAN_PURPOSE, moneyText } from "../inventory-config";
import { useInventoryAccess } from "../useInventoryAccess";

type Item = LotteryTicketLookupItemFieldsFragment;

export interface LookupDialogProps {
  onClose: () => void;
}

/**
 * 查刮刮樂(Figma IN-02 平板 126:25973 / 手機 126:26395;規格 7.3):刷條碼或輸入背面編號
 * (也收正面編號、正面條碼)。對到的張顯示在下方(同一個本號對到多款遊戲時每款一張卡片);
 * [查詢] 或點卡片跳到那一本並標亮那一張(`?ticket=`)。開著時宣告掃描用途 `inventory-lookup`。
 */
export const LookupDialog = ({ onClose }: LookupDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useInventoryAccess();
  const isMobile = useBreakpointDown("sm");
  const [text, setText] = useState("");
  const parsed: ParsedTicketInput | null = parseTicketInput(text);

  useScanner(INVENTORY_LOOKUP_SCAN_PURPOSE, ({ code }) => {
    setText(code);
  });

  const query = useLotteryTicketLookupQuery(
    session.client,
    {
      input: {
        bookNo: parsed?.bookNo ?? "",
        ticketNo: parsed?.ticketNo ?? "",
        ...(parsed?.gameCode === undefined
          ? {}
          : { gameCode: parsed.gameCode }),
      },
    },
    { enabled: parsed !== null },
  );
  const items =
    parsed === null ? [] : (query.data?.lotteryTicketLookup.items ?? []);

  const open = (item: Item) => {
    if (access.bookRoute === null) {
      return;
    }
    onClose();
    void navigate(`${access.bookRoute}/${item.bookId}?ticket=${item.ticketNo}`);
  };

  const resultText = (item: Item) =>
    [
      t("lookup.bookNo", { bookNo: displayBookNo(item.bookNo) }),
      t("lookup.ticketNo", { ticketNo: item.ticketNo }),
      t(`ticketStatuses.${item.status}`),
      item.responsibleOrg
        ? t("lookup.responsible", { store: item.responsibleOrg.name })
        : item.org.name,
    ].join(" · ");

  let hint: string | null = null;
  if (text.trim() !== "" && parsed === null) {
    hint = t("lookup.invalid");
  } else if (parsed !== null && !query.isLoading && items.length === 0) {
    hint = t("lookup.notFound");
  }

  const isInvalid = hint === t("lookup.invalid");
  const first = items.at(0);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("lookup.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={items.length !== 1 || access.bookRoute === null}
            onClick={() => {
              if (first) {
                open(first);
              }
            }}
          >
            {t("lookup.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={t("lookup.input")}
          value={text}
          fullWidth
          error={isInvalid}
          // 格式錯的原因寫在欄位正下方(REACT-18);沒錯時是輸入說明
          helperText={isInvalid ? t("lookup.invalid") : t("lookup.hint")}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        {hint === null || isInvalid ? null : (
          <Typography variant="body2" color="warning">
            {hint}
          </Typography>
        )}
        {items.map((item) => (
          <Box
            key={`${item.bookId}:${item.ticketNo}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              open(item);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                open(item);
              }
            }}
            sx={{
              bgcolor: "action.hover",
              borderRadius: 1,
              p: 1.5,
              cursor: access.bookRoute === null ? "default" : "pointer",
            }}
          >
            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
              <Typography variant="subtitle1" color="textPrimary">
                {item.gameCode} {item.gameName}
              </Typography>
              <Typography variant="body2">
                {t("common.unitPrice", { price: moneyText(item.unitPrice) })}
              </Typography>
            </Stack>
            <Typography variant="body2">{resultText(item)}</Typography>
          </Box>
        ))}
      </Stack>
    </Dialog>
  );
};
