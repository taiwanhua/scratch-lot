import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryCountModeChangeCheckQuery,
  useLotteryCountModeChangeCheckQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import {
  type LotterySettingItem,
  type LotterySettings,
  type SettingTranslate,
  optionText,
} from "../setting-display";

type Check = LotteryCountModeChangeCheckQuery["lotteryCountModeChangeCheck"];

export interface SettingDialogProps {
  item: LotterySettingItem;
  settings: Pick<
    LotterySettings,
    "orgId" | "orgName" | "isTenantTop" | "isStore" | "canEdit"
  >;
  isPending: boolean;
  onSave: (option: string) => void;
  onRestore: () => void;
  /** [變更紀錄](分店的盤點制度;手機上列裡沒有這顆,放在對話框) */
  onHistory?: () => void;
  onClose: () => void;
}

/**
 * 編輯一條設定的對話框(Figma CS-50b / c / d / f;規格第 4 節、9.1、9.2、10、13.1):
 * 選項各附一句說明;儲存 = [自訂](本層寫一筆)。本層已自訂時左下角 [還原成沿用]。手機全螢幕。
 *
 * - **盤點制度**:選了不同的值就向 api 檢查(`lotteryCountModeChangeCheck`),寫出後果 ——
 *   改張數 = 當下生效;改編號 = 進入轉換中(之後銷售一律要刷或點格子,並要做一次全店補點編號);
 *   在上層改預設時列出會跟著改的分店。檯面上還有待標註的本、或有進行中的盤點 / 重刷 / 補點編號 → 列出、不能存
 * - **張數店補點編號**:從必須改成只提醒時,寫出「這個月關帳時改成只警告…」(10)
 */
export const SettingDialog = ({
  item,
  settings,
  isPending,
  onSave,
  onRestore,
  onHistory,
  onClose,
}: SettingDialogProps) => {
  const t = useTranslations("admin.lotterySettings");
  const translate: SettingTranslate = (key, values) => t(key, values);
  const isMobile = useBreakpointDown("sm");
  const { session } = useSession();
  const [option, setOption] = useState(item.effective.option);
  const isOwn = item.effective.source === "own";
  const isCountMode = item.key === "count_mode";
  const isChanged = option !== item.effective.option;
  const check = useLotteryCountModeChangeCheckQuery(
    session.client,
    { input: { orgId: settings.orgId, option } },
    { enabled: isCountMode && isChanged && settings.canEdit },
  );
  const result: Check | undefined = check.data?.lotteryCountModeChangeCheck;
  const isChecking = isCountMode && isChanged && result === undefined;
  const canSave =
    settings.canEdit &&
    !isPending &&
    !isChecking &&
    (!isCountMode || !isChanged || result?.canSave === true);

  const label = t(`labels.${item.key}`);
  const title = settings.isTenantTop
    ? t("dialog.titleDefault", { label, org: settings.orgName })
    : t("dialog.title", { label, org: settings.orgName });
  const descriptionOf = (value: string) =>
    isCountMode && !settings.isStore
      ? t(`descriptions.count_mode_upper.${value}`)
      : t(`descriptions.${item.key}.${value}`);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={title}
      actions={
        settings.canEdit ? (
          <>
            {isOwn && (
              <Button
                variant="text"
                sx={{ mr: "auto" }}
                disabled={isPending}
                onClick={onRestore}
              >
                {t("dialog.restore")}
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {t("dialog.cancel")}
            </Button>
            <Button
              disabled={!canSave}
              onClick={() => {
                onSave(option);
              }}
            >
              {t("dialog.save")}
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={onClose}>
            {t("dialog.close")}
          </Button>
        )
      }
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        {item.options.map((value) => (
          <Box key={value}>
            <FormControlLabel
              label={optionText(translate, item.key, value)}
              disabled={!settings.canEdit}
              control={
                <Radio
                  checked={option === value}
                  onChange={() => {
                    setOption(value);
                  }}
                />
              }
            />
            <Typography
              variant="caption"
              color="textSecondary"
              component="p"
              sx={{ pl: 4 }}
            >
              {descriptionOf(value)}
            </Typography>
          </Box>
        ))}
        {item.key === "renumber_required" &&
          item.effective.option === "required" &&
          option === "remind" && (
            <Alert severity="warning">{t("dialog.renumberToRemind")}</Alert>
          )}
        {isCountMode && isChanged && (
          <CountModeCheck
            check={result}
            isChecking={isChecking}
            isStore={settings.isStore}
            option={option}
          />
        )}
        {onHistory !== undefined && (
          <Box sx={{ display: { sm: "none" } }}>
            <Button variant="text" size="small" onClick={onHistory}>
              {t("history")}
            </Button>
          </Box>
        )}
      </Stack>
    </Dialog>
  );
};

/** 盤點制度改動的後果與擋下的明細。 */
const CountModeCheck = ({
  check,
  isChecking,
  isStore,
  option,
}: {
  check: Check | undefined;
  isChecking: boolean;
  isStore: boolean;
  option: string;
}) => {
  const t = useTranslations("admin.lotterySettings.check");
  if (isChecking || check === undefined) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("checking")}
      </Typography>
    );
  }
  const separator = t("separator");
  const converting = check.stores.filter((store) => store.to === "converting");
  const blocked = check.stores.filter((store) => store.problems.length > 0);
  const busyText = (orgName: string) => t("busy", { org: orgName });

  if (isStore) {
    const store = check.stores.at(0);
    return (
      <Stack spacing={1}>
        {check.pendingSkipBooks.length > 0 && (
          <>
            <Alert severity="error">{t("pendingSkip")}</Alert>
            <PendingSkipList books={check.pendingSkipBooks} />
          </>
        )}
        {check.busyStores.map((busy) => (
          <Alert key={busy.orgId} severity="error">
            {busyText(busy.orgName)}
          </Alert>
        ))}
        {check.canSave && store?.to === "converting" && (
          <Alert severity="warning">
            {t("toConverting", { org: store.orgName })}
          </Alert>
        )}
        {check.canSave && store?.to === "numbered" && option === "numbered" && (
          <Alert severity="info">{t("toNumbered")}</Alert>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ justifyContent: "space-between" }}
      >
        <Typography variant="body2" color="textSecondary">
          {option === "count"
            ? t("followingToCount")
            : t("followingToNumbered")}
        </Typography>
        <Typography variant="body2" sx={{ textAlign: "right" }}>
          {check.stores.length === 0
            ? t("noneFollowing")
            : check.stores.map((store) => store.orgName).join(separator)}
        </Typography>
      </Stack>
      {blocked.length > 0 && (
        <Alert severity="error">
          {t("blocked", {
            reasons: [
              ...check.pendingSkipBooks.map((book) =>
                t("blockedPendingSkip", {
                  org: book.orgName,
                  cashPoint: book.cashPointName,
                  gameCode: book.gameCode,
                  bookNo: book.bookNo,
                  count: book.pendingCount,
                }),
              ),
              ...check.busyStores.map((busy) => busyText(busy.orgName)),
            ].join(t("reasonSeparator")),
          })}
        </Alert>
      )}
      {check.canSave && converting.length > 0 && (
        <Alert severity="warning">
          {t("toConverting", {
            org: converting.map((store) => store.orgName).join(separator),
          })}
        </Alert>
      )}
    </Stack>
  );
};

const PendingSkipList = ({ books }: { books: Check["pendingSkipBooks"] }) => {
  const t = useTranslations("admin.lotterySettings.check");
  return (
    <Stack spacing={0.5}>
      {books.map((book) => (
        <Stack
          key={`${book.orgId}-${book.cashPointName}-${book.gameCode}-${book.bookNo}`}
          direction="row"
          spacing={2}
          sx={{ justifyContent: "space-between" }}
        >
          <Typography variant="body2" color="textSecondary">
            {t("pendingSkipBook", {
              cashPoint: book.cashPointName,
              gameCode: book.gameCode,
              gameName: book.gameName,
              bookNo: book.bookNo,
            })}
          </Typography>
          <Typography variant="body2">
            {t("pendingSkipCount", { count: book.pendingCount })}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
};
