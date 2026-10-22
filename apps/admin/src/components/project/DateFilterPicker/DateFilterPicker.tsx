import { useState } from "react";

import { DatePicker, type DatePickerProps } from "@repo/ui/date-picker";

export interface DateFilterPickerProps extends Omit<
  DatePickerProps,
  "value" | "defaultValue" | "onChange"
> {
  /** 目前套用中的日期 `YYYY-MM-DD`;沒有條件為 `null` 或 `""` */
  value: string | null;
  /** 完成一個日期或清空時才回呼(清空為 `null`);打到一半不回呼,查詢沿用上一個有效值 */
  onChange: (value: string | null) => void;
}

/**
 * 篩選條件用的日期欄:鍵盤打到一半(年份沒打滿、只填了部分區段、2/31)時,
 * 畫面保留使用者打的字、查詢不動;完成或清空才交給呼叫端套用。
 *
 * 直接用 `DatePicker` 的篩選欄,打到一半送出的 `null` 會被呼叫端換成預設值(月初、今天)或直接忽略,
 * 傳回來的值跟剛送出的不同,欄位就用它蓋掉草稿(看不到自己打的數字);沒有預設值的則會先送一次不帶日期的查詢。
 * 外部換成別的值(快捷鍵、掃 QR 帶入)照常覆蓋。
 */
export const DateFilterPicker = ({
  value,
  onChange,
  ...props
}: DateFilterPickerProps) => {
  const applied = value === "" ? null : value;
  // 打到一半時記下當時套用中的值;套用值沒變就讓欄位收 `null`,與欄位剛送出的 `null` 相同,草稿才會留著
  const [pendingFrom, setPendingFrom] = useState<{
    value: string | null;
  } | null>(null);
  const isPending = pendingFrom !== null && pendingFrom.value === applied;

  return (
    <DatePicker
      {...props}
      value={isPending ? null : applied}
      onChange={(next, { isIncomplete }) => {
        if (isIncomplete) {
          setPendingFrom({ value: applied });
          return;
        }
        setPendingFrom(null);
        onChange(next);
      }}
    />
  );
};
