import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  type CreateMyDelegationMutation,
  useCreateMyDelegationMutation,
  useMyDelegationsQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { UserPickerField } from "@/components/base/UserPicker/UserPickerField";
import type { UserCandidate } from "@/components/base/UserPicker/useUserCandidates";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  delegationEndOf,
  delegationStartOf,
} from "@/lib/base/delegation-period";

import { delegationsErrorKey, delegationsErrorOf } from "./delegations-error";
import { useDelegateCandidates } from "./useDelegateCandidates";

export interface NewDelegationDialogProps {
  onClose: () => void;
}

/**
 * 新增代理:代理人、開始日、結束日、備註。
 * 選的是最上層組織時區的日期:起 = 當天 00:00、迄 = 結束日 24:00(「日期只有一種做法」)。
 * 重疊、代理人不可選等由 api 擋(`VALIDATION_FAILED` + reason),失敗跳提示、彈窗留著讓使用者改。
 */
export const NewDelegationDialog = ({ onClose }: NewDelegationDialogProps) => {
  const t = useTranslations("admin.personalSettings.delegations");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const candidates = useDelegateCandidates();
  const [delegate, setDelegate] = useState<UserCandidate | null>(null);
  const [startDay, setStartDay] = useState<string | null>(null);
  const [endDay, setEndDay] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const create = useCreateMyDelegationMutation(
    session.client,
    useMutationFeedback<CreateMyDelegationMutation>({
      success: t("created"),
      error: (error) =>
        t(`errors.${delegationsErrorKey(delegationsErrorOf(error))}`),
      onSuccess: () => {
        // DATA-04 (b):沒有單筆查詢可寫,清單各頁一次失效(getKey 第一段當前綴)
        void queryClient.invalidateQueries({
          queryKey: [useMyDelegationsQuery.getKey({ input: {} })[0]],
        });
        onClose();
      },
    }),
  );

  const startAt = delegationStartOf(startDay, timezone);
  const endAt = delegationEndOf(endDay, timezone);
  const isPeriodInvalid =
    startDay !== null && endDay !== null && endDay < startDay;
  const canSubmit =
    delegate !== null &&
    startAt !== null &&
    endAt !== null &&
    !isPeriodInvalid &&
    !create.isPending;

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("dialogTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (delegate === null || startAt === null || endAt === null) {
                return;
              }
              const trimmed = note.trim();
              create.mutate({
                input: {
                  delegateUserId: delegate.id,
                  startAt,
                  endAt,
                  note: trimmed === "" ? null : trimmed,
                },
              });
            }}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <UserPickerField
          users={candidates}
          label={t("delegate")}
          value={delegate}
          onChange={setDelegate}
        />
        <Stack direction="row" spacing={1.5}>
          <DatePicker
            label={t("startDay")}
            value={startDay}
            onChange={setStartDay}
            required
            fullWidth
            size="small"
          />
          <DatePicker
            label={t("endDay")}
            value={endDay}
            onChange={setEndDay}
            minDate={startDay ?? undefined}
            required
            error={isPeriodInvalid}
            helperText={isPeriodInvalid ? t("endBeforeStart") : undefined}
            fullWidth
            size="small"
          />
        </Stack>
        <TextField
          label={t("note")}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          fullWidth
          size="small"
        />
      </Stack>
    </Dialog>
  );
};
