import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import {
  type TicketSelectionInput,
  selectTicketRange,
} from "@/lib/project/lottery/ticket-selection";

export interface TicketQuickSelectProps {
  selection: TicketSelectionInput;
  onSelectedChange: (selected: string[]) => void;
}

/** 張號輸入框的字數上限(3 位)。 */
const TICKET_NO_LENGTH = 3;

/** 「連號快選 從 [ ] 到 [ ] [加入]」(專案規格 7.5):區間內能選的張全部加入已選。 */
export const TicketQuickSelect = ({
  selection,
  onSelectedChange,
}: TicketQuickSelectProps) => {
  const t = useTranslations("admin.lotteryInventory.ticketGrid.quickSelect");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
  ) => (
    <TextField
      size="small"
      value={value}
      onChange={(event) => {
        onChange(event.target.value.replaceAll(/\D/g, ""));
      }}
      slotProps={{
        htmlInput: {
          "aria-label": label,
          inputMode: "numeric",
          maxLength: TICKET_NO_LENGTH,
        },
      }}
      sx={{ width: (theme) => theme.spacing(10) }}
    />
  );
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <Typography variant="body2">{t("label")}</Typography>
      <Typography variant="body2">{t("from")}</Typography>
      {field(t("fromAria"), from, setFrom)}
      <Typography variant="body2">{t("to")}</Typography>
      {field(t("toAria"), to, setTo)}
      <Button
        variant="outlined"
        size="small"
        disabled={from === "" || to === ""}
        onClick={() => {
          onSelectedChange(selectTicketRange(selection, from, to));
        }}
      >
        {t("add")}
      </Button>
    </Stack>
  );
};
