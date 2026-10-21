import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import {
  type DayOffSlot,
  EMPTY_SLOT,
  isCompleteSlot,
} from "@/lib/project/schedule-day-offs";

export interface DayOffSlotFieldsProps {
  slots: readonly DayOffSlot[];
  /** 送出時有沒填完或開始不早於結束的段落:標紅 */
  invalid: boolean;
  onChange: (slots: DayOffSlot[]) => void;
  /** 可以一次登記多段([+ 再加一段]);代改一次一段 */
  allowMultiple?: boolean;
}

/** 時段不可排的開始 / 結束(`HH:mm`);選了時段不可排才出現。 */
export const DayOffSlotFields = ({
  slots,
  invalid,
  onChange,
  allowMultiple = false,
}: DayOffSlotFieldsProps) => {
  const t = useTranslations("admin.schedule.dayOffs.dialog");
  const update = (index: number, patch: Partial<DayOffSlot>) => {
    onChange(
      slots.map((slot, current) =>
        current === index ? { ...slot, ...patch } : slot,
      ),
    );
  };
  return (
    <Stack spacing={1.5}>
      {slots.map((slot, index) => {
        const error = invalid && !isCompleteSlot(slot);
        return (
          // 段落沒有自己的 id;順序就是身分(只會在尾端加、從中間拿掉)
          <Stack key={index} direction="row" spacing={1.5}>
            <TextField
              label={t("start")}
              type="time"
              value={slot.startTime}
              required
              fullWidth
              error={error}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(event) => {
                update(index, { startTime: event.target.value });
              }}
            />
            <TextField
              label={t("end")}
              type="time"
              value={slot.endTime}
              required
              fullWidth
              error={error}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(event) => {
                update(index, { endTime: event.target.value });
              }}
            />
            {slots.length > 1 && (
              <IconButton
                aria-label={t("removeSlot")}
                sx={{ alignSelf: "center" }}
                onClick={() => {
                  onChange(slots.filter((_, current) => current !== index));
                }}
              >
                <CloseIcon />
              </IconButton>
            )}
          </Stack>
        );
      })}
      {allowMultiple && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            onChange([...slots, EMPTY_SLOT]);
          }}
        >
          {t("addSlot")}
        </Button>
      )}
    </Stack>
  );
};
