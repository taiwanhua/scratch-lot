import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { Autocomplete } from "../Autocomplete/Autocomplete";
import { DatePicker } from "../DatePicker/DatePicker";
import { DateTimePicker } from "../DateTimePicker/DateTimePicker";
import { ModuleIconPicker } from "../ModuleIconPicker/ModuleIconPicker";
import { SelectField } from "../SelectField/SelectField";
import { TextField } from "../TextField/TextField";

type Size = "small" | "medium";

/**
 * 表單欄位的高度契約:每一種欄位不給 `size` 時都是 `medium`(MUI 的預設),給 `small` 才變矮。
 * 同一張表單混用不同欄位時,只要同一組 `size` 高度就一致;任何一種欄位的預設跟別人不同,
 * 呼叫端「沒寫 size」的那一格就會比隔壁高或矮一截(日期欄、組織欄在 small 表單裡高一截就是這樣來的)。
 */
const FIELDS: readonly [string, (size?: Size) => ReactElement][] = [
  ["TextField", (size) => <TextField label="欄位" size={size} />],
  [
    "SelectField",
    (size) => (
      <SelectField
        label="欄位"
        size={size}
        value="a"
        options={[{ value: "a", label: "A" }]}
        onChange={jest.fn()}
      />
    ),
  ],
  [
    "Autocomplete",
    (size) => (
      <Autocomplete<string>
        label="欄位"
        size={size}
        options={["A"]}
        value={null}
        onChange={jest.fn()}
        getOptionLabel={(option) => option}
      />
    ),
  ],
  ["DatePicker", (size) => <DatePicker label="欄位" size={size} />],
  ["DateTimePicker", (size) => <DateTimePicker label="欄位" size={size} />],
  [
    "ModuleIconPicker",
    (size) => <ModuleIconPicker label="欄位" size={size} value={null} />,
  ],
];

/** 欄位的尺寸看標籤:MUI 與 MUI X 的欄位都把 `size` 反映在 `MuiInputLabel-sizeSmall` 上。 */
const isSmall = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const small = container.querySelector(".MuiInputLabel-sizeSmall") !== null;
  unmount();
  return small;
};

describe("表單欄位的 size 契約", () => {
  it.each(FIELDS)("%s 不給 size 時是 medium", (_name, build) => {
    expect(isSmall(build())).toBe(false);
  });

  it.each(FIELDS)('%s 給 size="small" 時是 small', (_name, build) => {
    expect(isSmall(build("small"))).toBe(true);
  });
});
