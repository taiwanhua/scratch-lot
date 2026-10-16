import { useState } from "react";

import { OrgTreeSelect, type OrgTreeSelectProps } from "./OrgTreeSelect";

export interface OrgTreeSelectHarnessProps extends Omit<
  OrgTreeSelectProps,
  "value" | "onChange" | "label"
> {
  initial?: readonly string[];
}

/**
 * 測試專用的受控外殼(`org-tree-select-test-support.ts` 用):把選取結果寫在畫面上,
 * 斷言「送出去的是什麼」。只給元件測試用,沒有頁面引用。
 */
export const OrgTreeSelectHarness = ({
  initial = [],
  ...props
}: OrgTreeSelectHarnessProps) => {
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <>
      <OrgTreeSelect
        label="組織"
        value={value}
        onChange={setValue}
        {...props}
      />
      <output data-testid="value">{value.join(",")}</output>
    </>
  );
};
