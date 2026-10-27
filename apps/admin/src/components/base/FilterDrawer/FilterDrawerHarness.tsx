import { useState } from "react";

import { TextField } from "@repo/ui/text-field";

import { FilterDrawer } from "./FilterDrawer";

interface HarnessValue {
  status: string;
}

const EMPTY: HarnessValue = { status: "" };

/**
 * 測試專用的受控外殼(`FilterDrawer.test.tsx` 用):套用中的值寫在畫面上,斷言「寫回的是什麼」。
 * 欄位是一個文字框「狀態」。只給元件測試用,沒有頁面引用。
 */
export const FilterDrawerHarness = () => {
  const [value, setValue] = useState<HarnessValue>({ status: "on_sale" });
  return (
    <>
      <FilterDrawer
        value={value}
        emptyValue={EMPTY}
        activeCount={value.status === "" ? 0 : 1}
        onApply={setValue}
        renderFields={(current, change) => (
          <TextField
            label="狀態"
            value={current.status}
            onChange={(event) => {
              change({ status: event.target.value });
            }}
          />
        )}
      />
      <output data-testid="applied">{value.status}</output>
    </>
  );
};
