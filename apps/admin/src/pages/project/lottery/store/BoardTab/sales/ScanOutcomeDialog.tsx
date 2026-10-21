import { useState } from "react";

import { displayBookNo } from "@repo/domain/project/lottery";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../../store-text";
import { ScanTicketSummary } from "./ScanTicketSummary";
import type { ScanItem } from "./scan-place";
import { useSalesText } from "./useSalesText";

/**
 * 刷到時要問人的情況(ST-05a–e;快速銷售另見 `QuickSaleDialog`):
 * `pick` 選遊戲、`otherMine` 你開的班(確認售出)、`move` 移櫃並售出、`unopened` 這本還沒拆、
 * `blocked` 不能銷售(原因或自由文字)、`info` 銷售條件不符只顯示資訊。
 */
export type ScanPrompt =
  | { kind: "pick"; items: readonly ScanItem[] }
  | { kind: "otherMine" | "move" | "unopened" | "info"; item: ScanItem }
  | { kind: "blocked"; item: ScanItem | null; message: string };

export interface ScanOutcomeDialogProps {
  prompt: ScanPrompt;
  /** 本機收銀點名稱(移櫃並售出、拆本的說明) */
  localName: string;
  busy: boolean;
  onClose: () => void;
  onPick: (item: ScanItem) => void;
  /** 確認售出 / 移櫃並售出 */
  onConfirm: (item: ScanItem) => void;
  /** 拆本並售出 */
  onSplit: (item: ScanItem) => void;
}

const PickGame = ({
  items,
  onClose,
  onPick,
}: {
  items: readonly ScanItem[];
  onClose: () => void;
  onPick: (item: ScanItem) => void;
}) => {
  const { t } = useSalesText();
  const [picked, setPicked] = useState(items[0]?.ticketId ?? "");
  const choice = items.find((item) => item.ticketId === picked);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("scan.pickTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("sale.cancel")}
          </Button>
          <Button
            disabled={choice === undefined}
            onClick={() => {
              if (choice) {
                onPick(choice);
              }
            }}
          >
            {t("scan.continue")}
          </Button>
        </>
      }
    >
      <Typography variant="body2" sx={{ mb: 1 }}>
        {t("scan.pickHint", {
          bookNo: displayBookNo(items[0]?.bookNo ?? ""),
          count: items.length,
        })}
      </Typography>
      <RadioGroup
        value={picked}
        onChange={(event) => {
          setPicked(event.target.value);
        }}
      >
        {items.map((item) => (
          <FormControlLabel
            key={item.ticketId}
            value={item.ticketId}
            control={<Radio />}
            label={t("scan.pickOption", {
              code: item.gameCode,
              name: item.gameName,
              price: moneyText(item.unitPrice),
            })}
          />
        ))}
      </RadioGroup>
    </Dialog>
  );
};

/**
 * 刷到時的對話框(Figma ST-05a 你開的班、05b 移櫃並售出、05c 選遊戲、05d 這本還沒拆、05e 不能銷售;
 * 規格 6.3、3.3)。待查的尋回用庫存管理的 `RecoverTicketDialog`(ST-05f)。
 */
export const ScanOutcomeDialog = ({
  prompt,
  localName,
  busy,
  onClose,
  onPick,
  onConfirm,
  onSplit,
}: ScanOutcomeDialogProps) => {
  const { t } = useSalesText();
  if (prompt.kind === "pick") {
    return <PickGame items={prompt.items} onClose={onClose} onPick={onPick} />;
  }
  if (prompt.kind === "blocked") {
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="xs"
        title={t("scan.blockedTitle")}
        actions={<Button onClick={onClose}>{t("scan.gotIt")}</Button>}
      >
        <Stack spacing={2}>
          {prompt.item === null ? null : (
            <ScanTicketSummary item={prompt.item} />
          )}
          <Alert severity="error">{prompt.message}</Alert>
        </Stack>
      </Dialog>
    );
  }
  const { item } = prompt;
  const cashPoint = item.cashPoint?.name ?? "";
  const content = {
    otherMine: {
      title: t("scan.otherMineTitle", { cashPoint }),
      body: (
        <Alert severity="success">
          {t("scan.otherMineHint", { cashPoint })}
        </Alert>
      ),
      submit: t("scan.confirmSell"),
      onSubmit: () => {
        onConfirm(item);
      },
    },
    move: {
      title: t("scan.moveTitle"),
      body: (
        <Typography variant="body2">
          {t("scan.moveHint", { from: cashPoint, to: localName })}
        </Typography>
      ),
      submit: t("scan.moveAndSell"),
      onSubmit: () => {
        onConfirm(item);
      },
    },
    unopened: {
      title: t("scan.unopenedTitle"),
      body: (
        <Typography variant="body2">
          {t("scan.unopenedHint", { cashPoint: localName })}
          {item.pendingSkipCount > 0
            ? t("scan.unopenedSkipHint", { count: item.pendingSkipCount })
            : null}
        </Typography>
      ),
      submit: t("scan.splitAndSell"),
      onSubmit: () => {
        onSplit(item);
      },
    },
    info: {
      title: t("scan.infoTitle"),
      body: (
        <Typography variant="body2" color="text.secondary">
          {t("scan.infoHint")}
        </Typography>
      ),
      submit: null,
      onSubmit: onClose,
    },
  }[prompt.kind];
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={content.title}
      actions={
        content.submit === null ? (
          <Button onClick={onClose}>{t("scan.gotIt")}</Button>
        ) : (
          <>
            <Button variant="text" onClick={onClose}>
              {t("sale.cancel")}
            </Button>
            <Button disabled={busy} onClick={content.onSubmit}>
              {content.submit}
            </Button>
          </>
        )
      }
    >
      <Stack spacing={2}>
        <ScanTicketSummary item={item} />
        {content.body}
      </Stack>
    </Dialog>
  );
};
