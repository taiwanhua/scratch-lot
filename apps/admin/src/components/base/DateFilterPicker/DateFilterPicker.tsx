import { useEffect, useRef, useState } from "react";

import { Box } from "@repo/ui/box";
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
 * 打到一半就離開欄位(焦點移出整個欄位)時,畫面還原成目前套用中的值,與實際查詢一致。
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

  // 離開時一律重掛欄位,畫面就是套用中的值:套用中的值若是 `null`,與欄位剛送出的 `null` 相同,
  // 不重掛就清不掉打到一半的字(打完的值重掛後顯示不變)
  const [mountKey, setMountKey] = useState(0);
  // 「離開」= blur 之後焦點沒有回到欄位裡。日曆彈窗在 portal 裡(DOM 不在欄位底下),
  // 但 React 的 focus 事件照元件樹冒泡上來,所以等焦點落定:有 focus 冒上來就不算離開
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      clearTimeout(leaveTimer.current);
    },
    [],
  );
  const handleBlur = () => {
    clearTimeout(leaveTimer.current);
    // 不只看 isPending:從空白開始打,MUI 在區段填滿前不回呼(值一直是 null),這邊不知道有草稿
    leaveTimer.current = setTimeout(() => {
      // 切到別的視窗 / 分頁也會 blur,但焦點還留在欄位上:這時重掛會讓回來時焦點掉到 body、草稿也被清掉
      if (!document.hasFocus()) {
        return;
      }
      setPendingFrom(null);
      setMountKey((key) => key + 1);
    });
  };
  const handleFocus = () => {
    clearTimeout(leaveTimer.current);
  };

  return (
    // `display: contents` 不佔版面,只用來收整個欄位(各區段、日曆鈕、日曆彈窗)冒泡上來的 focus / blur
    <Box sx={{ display: "contents" }} onBlur={handleBlur} onFocus={handleFocus}>
      <DatePicker
        key={mountKey}
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
    </Box>
  );
};
