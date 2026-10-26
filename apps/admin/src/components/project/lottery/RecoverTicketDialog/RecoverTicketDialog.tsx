import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  useLotteryInventoryStoresQuery,
  useRecoverLotteryTicketsMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FieldErrorTexts,
  withoutFieldError,
} from "@/lib/base/field-errors";

import { ReasonFields } from "../ReasonFields/ReasonFields";
import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "../ReasonFields/reason-value";
import {
  inventoryErrorTextsOf,
  inventoryFormatErrorsOf,
} from "./inventory-field-errors";

/** 會標回對話框的欄位(api `fields`)。 */
const FIELDS = ["orgId", "reasonKey", "reasonNote"] as const;

/** 要尋回的一張:id、讀到的版本(條件更新)、張號、狀態(`investigating` / `lost`)。 */
export interface RecoverTicket {
  id: string;
  version: number;
  ticketNo: string;
  status: string;
  /** 目前所在分店的名稱(`keepStore` 時顯示「回到 X 庫存」) */
  orgName?: string;
}

export interface RecoverTicketDialogProps {
  /** 這本:遊戲代號、名稱、面額、本號(7 位) */
  book: {
    gameCode: string;
    gameName: string;
    unitPrice: number;
    bookNo: string;
  };
  tickets: readonly RecoverTicket[];
  /**
   * 從清單選(本的詳情、待查·遺失分頁):**不換店**,每張回到自己所在分店的庫存(不送 `orgId`;
   * 規格 7.4)。不給 = 刷到實體,回到 `store` 或目前組織
   */
  keepStore?: boolean;
  /**
   * 刷到實體時回到哪家店(刷到的那家店,例:店面看板)。不給 = 目前組織是店就回到它;目前組織不是店
   * (最上層組織、區域)時讓使用者選「回到哪家店」(只列看得到的店)
   */
  store?: { id: string; name: string };
  onClose: () => void;
  /** 尋回成功(對話框已關閉;呼叫端重讀自己的資料) */
  onRecovered?: () => void;
}

/** 尋回後要重讀的查詢(codegen 的 query key 第一段是 operation 名稱)。 */
const REFRESH_KEYS = [
  "LotteryInventoryBook",
  "LotteryInventoryBooks",
  "LotteryInvestigations",
  "LotteryTicketLookup",
];

/**
 * 尋回(Figma IN-04b;規格 7.4,`inventory.recover`):待查 / 遺失的張回到庫存,原因必填
 * (欄位管理「尋回原因」,選「其他」要填說明)。手機全螢幕。
 *
 * - 本的詳情頁、待查·遺失分頁(`keepStore`):不換店,每張回到自己所在分店的庫存
 * - 店面刷到待查或遺失的張(看板):回到一家**店**(`store`;沒給時用目前組織,目前組織不是店就選「回到哪家店」)
 */
export const RecoverTicketDialog = ({
  book,
  tickets,
  keepStore = false,
  store,
  onClose,
  onRecovered,
}: RecoverTicketDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const me = useMe();
  const stores = useLotteryInventoryStoresQuery(
    session.client,
    {},
    { enabled: !keepStore && store === undefined },
  );
  const storeOptions = stores.data?.lotteryInventoryStores.items ?? [];
  const currentOrgId = me.data?.me.currentOrg?.id ?? "";
  /** 目前組織就是一家店 → 直接回到它,不用選。 */
  const currentStore =
    storeOptions.find((option) => option.id === currentOrgId) ?? null;
  const fixedStore = keepStore
    ? {
        id: "",
        name: [...new Set(tickets.map((ticket) => ticket.orgName ?? ""))]
          .filter((name) => name !== "")
          .join("、"),
      }
    : (store ?? currentStore);
  const [pickedStoreId, setPickedStoreId] = useState("");
  const targetId = fixedStore?.id ?? pickedStoreId;
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);Snackbar 只放通用句
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<string>>({});
  const invalid = Object.keys(fieldErrors);
  const recover = useRecoverLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("recover.success", { count: tickets.length }),
      error: (error) => inventoryErrorTextsOf(error, FIELDS, t).summary,
      onSuccess: () => {
        for (const key of REFRESH_KEYS) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
        onClose();
        onRecovered?.();
      },
      onError: (error) => {
        setFieldErrors(inventoryErrorTextsOf(error, FIELDS, t).texts);
      },
    }),
  );
  const statuses = [...new Set(tickets.map((ticket) => ticket.status))];
  const submit = () => {
    const missing: string[] = missingReasonFields(reason);
    if (!keepStore && targetId === "") {
      missing.push("orgId");
    }
    setFieldErrors(inventoryFormatErrorsOf(missing, t));
    if (missing.length > 0) {
      return;
    }
    recover.mutate({
      input: {
        tickets: tickets.map((ticket) => ({
          ticketId: ticket.id,
          version: ticket.version,
        })),
        ...(keepStore ? {} : { orgId: targetId }),
        ...reasonInputOf(reason),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("recover.title", { count: tickets.length })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={recover.isPending} onClick={submit}>
            {t("recover.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="subtitle1" color="textPrimary">
              {book.gameCode} {book.gameName}
            </Typography>
            <Typography variant="body2">
              {t("common.unitPrice", {
                price: book.unitPrice.toLocaleString("en-US"),
              })}
            </Typography>
          </Stack>
          <Typography variant="body2">
            {t("recover.ticketLine", {
              bookNo: displayBookNo(book.bookNo),
              ranges: formatTicketRanges(
                tickets.map((ticket) => ticket.ticketNo),
              ),
              statuses: statuses
                .map((status) => t(`ticketStatuses.${status}`))
                .join("、"),
            })}
          </Typography>
        </Box>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.recoverReason}
          label={t("recover.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
          errorTexts={fieldErrors}
        />
        {fixedStore === null ? (
          <SelectField
            label={t("recover.pickStore")}
            value={pickedStoreId}
            required
            fullWidth
            error={invalid.includes("orgId")}
            helperText={fieldErrors.orgId}
            options={storeOptions.map((option) => ({
              value: option.id,
              label: option.name,
            }))}
            onChange={(next: string) => {
              setPickedStoreId(next);
              setFieldErrors((current) => withoutFieldError(current, "orgId"));
            }}
          />
        ) : (
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2">{t("recover.backTo")}</Typography>
            <Typography variant="body1" color="textPrimary">
              {t("recover.backToStore", { store: fixedStore.name })}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
};
