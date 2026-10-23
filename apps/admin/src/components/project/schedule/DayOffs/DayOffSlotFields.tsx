import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { TimePicker } from "@repo/ui/time-picker";

import { FieldErrorGroup } from "@/components/base/FieldErrorGroup/FieldErrorGroup";
import {
  type DayOffSlot,
  EMPTY_SLOT,
  hasWholeDaySlot,
  isCompleteSlot,
  isWholeDaySlot,
} from "@/lib/project/schedule-day-offs";

export interface DayOffSlotFieldsProps {
  slots: readonly DayOffSlot[];
  /** 送出時有沒填完或開始不早於結束的段落:標紅 */
  invalid: boolean;
  /**
   * 寫在時段下方的原因(REACT-18;沒填完、開始不早於結束、和已有時段重疊)。每段都填完了還是錯
   * (api 擋下的重疊)時,所有段落一起標紅。
   */
  errorText?: string;
  onChange: (slots: DayOffSlot[]) => void;
  /** 可以一次登記多段([+ 再加一段]);代改一次一段 */
  allowMultiple?: boolean;
}

/**
 * 時段不可排的開始 / 結束(`@repo/ui/time-picker`,值 `HH:mm`;送出時由呼叫端和日期合成時點);
 * 選了時段不可排才出現。有一段選了 00:00–00:00(整天)時,那一段標紅、群組下方提示改選整天畫休
 * (不等送出;呼叫端用 `hasWholeDaySlot` 停用儲存)。
 */
export const DayOffSlotFields = ({
  slots,
  invalid,
  errorText,
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
  const submitError = invalid ? errorText : undefined;
  return (
    <FieldErrorGroup
      label={t("slots")}
      errorText={hasWholeDaySlot(slots) ? t("wholeDaySlot") : submitError}
      spacing={1.5}
    >
      {slots.map((slot, index) => {
        const error =
          isWholeDaySlot(slot) ||
          (invalid && (!isCompleteSlot(slot) || slots.every(isCompleteSlot)));
        return (
          // 段落沒有自己的 id;順序就是身分(只會在尾端加、從中間拿掉)
          <Stack key={index} direction="row" spacing={1.5}>
            <TimePicker
              label={t("start")}
              value={slot.startTime === "" ? null : slot.startTime}
              required
              fullWidth
              error={error}
              onChange={(next) => {
                update(index, { startTime: next ?? "" });
              }}
            />
            <TimePicker
              label={t("end")}
              value={slot.endTime === "" ? null : slot.endTime}
              required
              fullWidth
              error={error}
              onChange={(next) => {
                update(index, { endTime: next ?? "" });
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
    </FieldErrorGroup>
  );
};
