import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { refundDefaultOf } from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  type LotteryStoreScanItemFieldsFragment,
  useLotteryStoreShiftOptionsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useLotteryFieldOptions } from "@/hooks/project/useLotteryFieldOptions/useLotteryFieldOptions";

import { moneyText } from "../../store-text";
import {
  type ReversalCountRow,
  type ReversalGroup,
  type ReversalScanKind,
  type SaleReversalState,
  addTicket,
  invalidFieldsOf,
  prefilledCountRowsOf,
  refundAmountOf,
  removeGroup,
  removeMatchTicket,
  saleReversalStoredValues,
  setGroupTickets,
} from "../sale-reversal-form";
import {
  SALE_REVERSAL_FORM_KEY,
  SALE_REVERSAL_PREFILL,
  SALE_REVERSAL_SCAN_PURPOSE,
  STORE_KEY,
} from "../store-forms-keys";
import { SaleReversalBookGroup } from "./SaleReversalBookGroup";
import { SaleReversalCountRows } from "./SaleReversalCountRows";
import { useSaleRefundPrint } from "./useSaleRefundPrint";
import {
  useSaleReversalCountStore,
  useSaleReversalPrefill,
} from "./useSaleReversalCountStore";
import { useSaleReversalScan } from "./useSaleReversalScan";

const prefillSchema = z.string().default("");

/** 明細列的 rowId。 */
const newRowId = (): string => crypto.randomUUID();

/**
 * 撤銷售出申請的替換新增頁(專案規格 8.5;Figma ST-31b 90:4601):分店、原因、刷條碼加入張數、
 * 每本一組張數格子(只能選本店已售、不在其他未結束撤銷單上的張)、退款給客人(依原因的預設代碼帶入,可改)、
 * 退款班次(預設送出人目前的班;只能選本店的班)、說明、退款金額(面額合計,唯讀)。沒有草稿,
 * 送出即進審核;存值交給表單引擎(`useFormDraft`),送出前的檢查與鎖定在 api 的掛接點。
 * 看板撤銷確認視窗 [送撤銷售出申請] 帶 `?ticket=<張 id>&org=<分店>`,打開時加入那一張。
 *
 * 張數店與轉換中(張數店規格 7.3 第 1、3 點、13.2;Figma CS-14):刷到或手輸不是確定張號的已售(未售、待查、遺失、
 * 已售·未對號)也能加入,列在那本格子下方標「已對號」(送出時伺服器先和刷的那一台(本機收銀點)最近一筆依張數售出對號再鎖);
 * 格子只有確定張號的已售能點,已售·未對號畫虛線;另有 [+ 加一列:依遊戲 + 張數](收銀點預設本機、遊戲、張數「最多 N 張」)。
 * 全店重刷「記已售但還在」帶 `place`(重刷刷到的位置)與 `reason`(盤點錯誤 → 不退款);依張數撤銷不符條件帶
 * `game` / `point` / `count`(一列「遊戲 + 張數」)。
 * 退款給客人 = 是且有收據機時按鈕是 [送出並列印收據]:送出成功後印退貨退款收據(還在審核標「待核准」)再離開。
 */
export const SaleReversalCreatePage = () => {
  const t = useTranslations("admin.lotteryStore.saleReversal");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const me = useMe();
  const access = useFormModuleAccess(STORE_KEY);
  const { creatableForms, isLoading: isFormsLoading } =
    useModuleForms(STORE_KEY);
  const form = creatableForms.find(
    (item) => item.key === SALE_REVERSAL_FORM_KEY,
  );
  const draft = useFormDraft(SALE_REVERSAL_FORM_KEY);
  const reasons = useLotteryFieldOptions(
    LOTTERY_FIELD_CATEGORY_KEYS.saleReversalReason,
  );
  useRouteTabItemLabel(t("tabLabel"));
  const refundPrint = useSaleRefundPrint();

  const [orgParam] = useUrlState(SALE_REVERSAL_PREFILL.org, prefillSchema);
  const [ticketParam] = useUrlState(
    SALE_REVERSAL_PREFILL.ticket,
    prefillSchema,
  );
  const prefill = useSaleReversalPrefill();
  const [orgChoice, setOrgChoice] = useState<string | null>(null);
  const orgId =
    orgChoice ??
    (orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam);
  // 從全店重刷進來:原因帶「盤點錯誤」,退款依原因的預設(= 否)
  const [reasonKey, setReasonKey] = useState(prefill.reason);
  const [refund, setRefund] = useState(prefill.refund);
  const [countRows, setCountRows] = useState<ReversalCountRow[]>(() =>
    prefilledCountRowsOf(prefill, newRowId),
  );
  const [shiftChoice, setShiftChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [groups, setGroups] = useState<ReversalGroup[]>([]);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);

  const shifts = useLotteryStoreShiftOptionsQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "" },
  );
  const shiftItems = shifts.data?.lotteryStoreShiftOptions.items ?? [];
  // 退款班次預設送出人目前的班
  const mine = shiftItems.find((item) => item.mine) ?? null;
  const refundShiftId = shiftChoice ?? mine?.id ?? "";
  const shiftOptions = shiftItems.map((item) => ({
    value: item.id,
    label: item.mine
      ? t("refundShiftCurrent", { label: item.label })
      : item.label,
  }));

  // 盤點制度與收銀點(張數店與轉換中:刷的票送出時對號、可加「依遊戲 + 張數」)
  const countStore = useSaleReversalCountStore(orgId);
  const { matching, ticketCashPointId } = countStore;

  const addItem = (
    item: LotteryStoreScanItemFieldsFragment,
    kind: ReversalScanKind,
  ) => {
    setGroups((current) =>
      addTicket(
        current,
        {
          bookId: item.bookId,
          gameCode: item.gameCode,
          gameName: item.gameName,
          bookNo: item.bookNo,
          unitPrice: item.unitPrice,
        },
        item.ticketNo,
        kind,
      ),
    );
  };

  const scan = useSaleReversalScan({
    orgId,
    matching,
    ready: countStore.loaded,
    prefillTicketId: ticketParam,
    onAdd: (item, kind) => {
      setNotice(null);
      setCode("");
      addItem(item, kind);
    },
    onNotice: setNotice,
  });

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && code.trim() !== "") {
      event.preventDefault();
      scan(code.trim());
    }
  };

  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  if (isFormsLoading || me.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (form === undefined) {
    return <Alert severity="error">{t("unavailable")}</Alert>;
  }

  // 退款給客人、有收據機 → [送出並列印收據]
  const printsReceipt = refund && refundPrint.canPrint;
  const state: SaleReversalState = {
    orgId,
    reasonKey,
    refund,
    refundShiftId,
    note,
    ticketCashPointId,
  };
  const submit = () => {
    const missing = invalidFieldsOf(state, groups, countRows);
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    void draft
      .submit(saleReversalStoredValues(state, groups, newRowId, countRows), [])
      .then(async (submitted) => {
        if (submitted === null) {
          // 張數不夠(被別人先撤或先鎖):重讀「最多 N 張」
          void queryClient.invalidateQueries({
            queryKey: ["LotteryStoreSaleReversalOptions"],
          });
          return;
        }
        showSnackbar("success", t("submitted"));
        // 退款給客人 → 送出成功後印退貨退款收據(規格第 12 章;還在審核標「待核准」)。
        // 轉圖節點在這一頁,印完(成功或失敗只記 log)才離開
        if (printsReceipt) {
          await refundPrint.print({
            submitted,
            orgId,
            refundShift:
              shiftItems.find((item) => item.id === refundShiftId) ?? null,
            reasonLabel: reasons.labelOf(reasonKey),
            groups,
            countRows,
          });
        }
        leave();
      });
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 960 }}>
      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h1">
            {t("title")}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <OrgTreeSelect
              // 業務表單欄位:可見範圍內的才能選(用法表 ④)
              scope="visible"
              label={t("branch")}
              value={orgId === "" ? [] : [orgId]}
              required
              fullWidth
              onChange={(ids) => {
                setOrgChoice(ids[0] ?? "");
                setGroups([]);
                setCountRows([]);
                setShiftChoice(null);
              }}
            />
            <SelectField
              label={t("reason")}
              value={reasonKey}
              required
              fullWidth
              error={invalid.includes("reason")}
              helperText={
                invalid.includes("reason") ? t("reasonRequired") : undefined
              }
              options={reasons.options}
              onChange={(next: string) => {
                setReasonKey(next);
                // 依預設選項代碼帶入「退款給客人」(客人退貨 = 是;其他 = 否),之後可改
                setRefund(refundDefaultOf(next));
              }}
            />
          </Stack>
          <TextField
            label={t("scan")}
            value={code}
            fullWidth
            disabled={orgId === ""}
            helperText={t("scanHint")}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            onKeyDown={handleKey}
            slotProps={{
              htmlInput: { "data-scanner-field": SALE_REVERSAL_SCAN_PURPOSE },
            }}
          />
          {notice !== null && <Alert severity="warning">{notice}</Alert>}
          {groups.length + countRows.length === 0 ? (
            <Typography
              variant="body2"
              color={invalid.includes("lines") ? "error" : "textSecondary"}
            >
              {t("noTickets")}
            </Typography>
          ) : (
            groups.map((group) => (
              <SaleReversalBookGroup
                key={group.bookId}
                orgId={orgId}
                group={group}
                onChange={(ticketNos) => {
                  setGroups((current) =>
                    setGroupTickets(current, group.bookId, ticketNos),
                  );
                }}
                onRemove={() => {
                  setGroups((current) => removeGroup(current, group.bookId));
                }}
                onRemoveMatch={(ticketNo) => {
                  setGroups((current) =>
                    removeMatchTicket(current, group.bookId, ticketNo),
                  );
                }}
              />
            ))
          )}
          <SaleReversalCountRows
            visible={matching}
            orgId={orgId}
            rows={countRows}
            cashPoints={countStore.cashPoints}
            localCashPointId={countStore.localCashPointId}
            error={invalid.includes("lines")}
            newRowId={newRowId}
            onChange={setCountRows}
          />
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" component="p">
              {t("refund")}
            </Typography>
            <Stack direction="row" spacing={2}>
              {([true, false] as const).map((option) => (
                <FormControlLabel
                  key={String(option)}
                  label={option ? t("yes") : t("no")}
                  control={
                    <Radio
                      checked={refund === option}
                      onChange={() => {
                        setRefund(option);
                      }}
                    />
                  }
                />
              ))}
            </Stack>
          </Stack>
          {refund ? (
            <SelectField
              label={t("refundShift")}
              value={refundShiftId}
              required
              fullWidth
              error={invalid.includes("refundShift")}
              helperText={
                invalid.includes("refundShift")
                  ? t("refundShiftRequired")
                  : undefined
              }
              options={shiftOptions}
              onChange={(next: string) => {
                setShiftChoice(next);
              }}
            />
          ) : null}
          <TextField
            label={t("note")}
            value={note}
            fullWidth
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <Stack direction="row" sx={{ alignItems: "baseline" }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {t("refundAmount")}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {moneyText(refund ? refundAmountOf(groups, countRows) : 0)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="textSecondary">
            {matching ? t("ruleCount") : t("rule")}
          </Typography>
          {draft.error !== null && (
            <Alert severity="error">{errorText(draft.error)}</Alert>
          )}
        </Stack>
      </Card>
      <FormActions
        cancel={{ label: t("cancel"), onClick: leave }}
        submit={{
          label: printsReceipt ? t("submitAndPrint") : t("submit"),
          disabled: draft.isPending || refundPrint.isPrinting,
          onClick: submit,
        }}
      />
      {refundPrint.host}
    </Stack>
  );
};
