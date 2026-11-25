import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TicketGrid } from "@/components/project/lottery/TicketGrid/TicketGrid";

export interface SkipStepProps {
  ticketNos: readonly string[];
  lastTicketNo: string;
  pending: number;
  skipped: string[];
  onChange: (skipped: string[]) => void;
  /** 說明(不給 = 原封不動的本「迄號 … 要點出 N 個跳號」) */
  hint?: ReactNode;
}

/** 拆本 ① 標跳號(店面拆本精靈、期初建檔頁共用):在庫存的張號點出不存在 / 手上沒有的號碼(剛好 `pending` 張)。 */
export const SkipStep = ({
  ticketNos,
  lastTicketNo,
  pending,
  skipped,
  onChange,
  hint,
}: SkipStepProps) => {
  const t = useTranslations("admin.lotteryStore");
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
