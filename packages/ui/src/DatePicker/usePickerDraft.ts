import type { Dayjs } from "dayjs";
import { useState } from "react";

/**
 * 年份區段還沒打滿 4 位時,MUI 組出來的是 `0002`、`0202` 這種年份。
 * 這種值不往外送:它不是使用者要的日期,而且 `dayjs("0002-…")` 會解析成 1902,往返一次就變成別的年份。
 */
const MIN_COMPLETE_YEAR = 1000;

/** MUI 回來的日期是否已經是可以往外送的完整值(合法、年份打滿 4 位)。 */
export const isCompleteDate = (date: Dayjs | null): date is Dayjs =>
  date?.isValid() === true && date.year() >= MIN_COMPLETE_YEAR;

/** `onChange` 的第二個參數:讓呼叫端分辨「清空」與「打到一半」(兩者都送 `null`)。 */
export interface PickerChangeDetails {
  /**
   * 欄位有輸入但還不是完整、合法的值(年份沒打滿 4 位、只填了一部分區段、2/31 這種不存在的日期)。
   * 清空(所有區段都空)與完成的值都是 `false`。
   * 篩選條件用它在打到一半時不改查詢,沿用上一個有效值。
   */
  isIncomplete: boolean;
}

interface Draft {
  /** 這份草稿對應的對外值:最後一次從外部收到、或最後一次送出去的字串 */
  value: string | null | undefined;
  /** 交給 MUI 的值:MUI 自己回傳的物件原樣保留,打字途中的區段才不會被重建 */
  date: Dayjs | null | undefined;
}

const fromValue = (
  value: string | null | undefined,
  toDate: (value: string) => Dayjs,
): Dayjs | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : toDate(value);
};

/**
 * 日期 / 日期時間包裝元件共用的草稿值。
 *
 * MUI X 的欄位以「物件同一性」判斷外部值有沒有變(`value !== lastExternalValue`),一變就用外部值重建所有區段。
 * 包裝層對外收發字串,如果每次 render 都 `dayjs(value)` 建新物件、或把打字途中送出的 `null` 傳回去,
 * MUI 就會在打字途中重建區段,按鍵被吃掉或被串成別的數字(年份打 `20` 變 `2200`)。
 *
 * 做法:保留 MUI 回傳的物件當草稿,記住它對應的對外字串。外部 `value` 與這個字串相同(就是剛送出去的值,
 * 包含打字途中的 `null`)時繼續用草稿;外部真的換成別的值,才用 `toDate(value)` 換掉草稿。
 * `value === undefined`(非受控)原樣往下傳,交給 MUI 自己管。
 * `value === ""` 視同 `null`:有呼叫端把清空存成空字串再傳回來(`value ?? ""`),
 * 若當成另一個值,打字途中送出的 `null` 一往返就會用不合法日期換掉草稿,已填的月、日跟著被清掉。
 *
 * 已知限制:打字途中已送出 `null`,外部此時再設成 `null`(例如重設成空白)分辨不出來,草稿會留著。
 */
export const usePickerDraft = ({
  value,
  toDate,
  toValue,
  onChange,
}: {
  value: string | null | undefined;
  /** 對外字串 → MUI 的值(只在外部值真的變了時呼叫) */
  toDate: (value: string) => Dayjs;
  /** MUI 的值 → 對外字串;未完成或不合法回 `null` */
  toValue: (date: Dayjs | null) => string | null;
  onChange?: (value: string | null, details: PickerChangeDetails) => void;
}) => {
  const external = value === "" ? null : value;
  const [draft, setDraft] = useState<Draft>(() => ({
    value: external,
    date: fromValue(external, toDate),
  }));

  // 外部換了值:render 期間依前一次的值調整 state(React 文件「儲存前一次 render 的資訊」),不用 effect
  let current = draft;
  if (external !== draft.value) {
    current = { value: external, date: fromValue(external, toDate) };
    setDraft(current);
  }

  const handleChange = (date: Dayjs | null) => {
    const next = toValue(date);
    if (external !== undefined) {
      setDraft({ value: next, date });
    }
    // MUI 在所有區段都空時回 `null`,有輸入但組不成完整日期時回不合法的物件
    onChange?.(next, { isIncomplete: date !== null && next === null });
  };

  return { date: current.date, handleChange };
};
