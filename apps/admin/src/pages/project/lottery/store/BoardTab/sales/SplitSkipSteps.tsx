import type { ReactNode } from "react";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { TicketGrid } from "@/components/project/lottery/TicketGrid/TicketGrid";

import type { SplitSkipPlan } from "./split-plan";
import { useSalesText } from "./useSalesText";

export interface SkipStepProps {
  ticketNos: readonly string[];
  lastTicketNo: string;
  pending: number;
  skipped: string[];
  onChange: (skipped: string[]) => void;
  /** 說明(不給 = 原封不動的本「迄號 … 要點出 N 個跳號」) */
  hint?: ReactNode;
}

/** 拆本 ① 標跳號:在庫存的張號點出不存在 / 手上沒有的號碼(剛好 `pending` 張)。 */
export const SkipStep = ({
  ticketNos,
  lastTicketNo,
  pending,
  skipped,
  onChange,
  hint,
}: SkipStepProps) => {
  const { t } = useSalesText();
  return (
    <Stack spacing={1.5}>
      {hint ?? (
        <Typography variant="body2">
          {t("split.skipHint", { last: lastTicketNo, count: pending })}
        </Typography>
      )}
      <TicketGrid
        cells={ticketNos.map((no) => ({ ticketNo: no, state: "unsold" }))}
        selectableStates={["unsold"]}
        selected={skipped}
        onSelectedChange={onChange}
        legendItems={["unsold", "selected"]}
        quickSelect={false}
        maxSelected={pending}
        summary={false}
      />
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="body2" color="textSecondary">
          {t("split.skipSelected")}
        </Typography>
        <Typography variant="body1">
          {t("split.skipSelectedValue", {
            count: skipped.length,
            total: pending,
            nos: skipped
              .toSorted((a, b) => a.localeCompare(b, COLLATION_LOCALE))
              .map((no) => `#${no}`)
              .join("、"),
          })}
        </Typography>
      </Stack>
    </Stack>
  );
};

export interface CountStepProps extends Omit<
  SkipStepProps,
  "hint" | "pending"
> {
  plan: SplitSkipPlan;
  actualText: string;
  onActualChange: (text: string) => void;
}

/**
 * 拆本 ①(張數店與轉換中、不是原封不動的本;張數店規格 7.5,Figma CS-08a / 08b / 08c):先數手上實際有幾張;
 * 比系統少 d 張 → 點出手上沒有的 d 個號碼(標跳號)才能下一步;少太多(超過待標註)或多了 → 擋下並說原因。
 */
export const CountStep = ({
  plan,
  actualText,
  onActualChange,
  ...skip
}: CountStepProps) => {
  const { t } = useSalesText();
  const { problem } = plan;
  // 多了 / 少太多:欄位下寫張數、下方寫原因與處理(Figma CS-08b / 08c)
  let errorText: string | null = null;
  let fieldText: string | undefined;
  switch (problem?.kind) {
    case "over": {
      errorText = t("split.countOver", { count: problem.count });
      fieldText = t("split.countOverField", { count: problem.count });
      break;
    }
    case "short": {
      errorText = t("split.countShort", { count: problem.count });
      fieldText = t("split.countShortField", { count: problem.count });
      break;
    }
    case "invalid": {
      errorText = t("split.countInvalid");
      break;
    }
    case undefined: {
      break;
    }
  }
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">{t("split.countHint")}</Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "flex-start" } }}
      >
        <TextField
          label={t("split.actualCount")}
          size="small"
          value={actualText}
          error={errorText !== null}
          helperText={fieldText}
          onChange={(event) => {
            onActualChange(event.target.value);
          }}
          sx={{ flex: 1 }}
        />
        <Typography variant="body2" color="textSecondary">
          {t("split.systemCount", { count: skip.ticketNos.length })}
        </Typography>
      </Stack>
      {errorText === null ? null : <Alert severity="error">{errorText}</Alert>}
      {plan.countReady && plan.pending > 0 ? (
        <SkipStep
          {...skip}
          pending={plan.pending}
          hint={
            <Alert severity="warning">
              {t("split.countSkipHint", { count: plan.pending })}
            </Alert>
          }
        />
      ) : null}
    </Stack>
  );
};
