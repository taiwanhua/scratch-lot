import { describe, expect, it } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import type { OrgNodeLike } from "@/lib/base/org-tree";

import { OrgTreePicker } from "./OrgTreePicker";

/**
 * 直接用 `OrgTreePicker`(使用者管理的篩選樹、選擇所屬組織彈窗都是直接用它)時,
 * 點反灰的上層不能動到已選的組織。
 * 夾具:示範公司 > 北區(A 店、B 店)、南區(C 店);只有 A 店在範圍內。
 */
const leaf = (id: string, name: string, outOfScope = true): OrgNodeLike => ({
  id,
  name,
  enabled: true,
  outOfScope,
  children: [],
});

const tree: OrgNodeLike[] = [
  {
    ...leaf("org-co", "示範公司"),
    children: [
      {
        ...leaf("org-north", "北區"),
        children: [leaf("org-a", "A 店", false), leaf("org-b", "B 店")],
      },
      { ...leaf("org-south", "南區"), children: [leaf("org-c", "C 店")] },
    ],
  },
];

const Harness = ({ isMultiSelect }: { isMultiSelect: boolean }) => {
  const [ids, setIds] = useState<string[]>(["org-a"]);
  return (
    <>
      <OrgTreePicker
        nodes={tree}
        isMultiSelect={isMultiSelect}
        selectedIds={ids}
        onSelectedIdsChange={setIds}
        aria-label="組織"
      />
      <output data-testid="value">{ids.join(",")}</output>
    </>
  );
};

const rowOf = (label: string): HTMLElement => {
  const row = screen
    .getAllByRole("treeitem")
    .find((item) => item.textContent.startsWith(label));
  if (row === undefined) {
    throw new Error(`missing row ${label}`);
  }
  return row;
};

describe("OrgTreePicker", () => {
  it.each<[string, boolean]>([
    ["單選", false],
    ["多選", true],
  ])(
    "%s:已選 A 店時點反灰的上層(北區)→ 仍然是 A 店",
    async (_, isMultiSelect) => {
      const user = userEvent.setup();
      render(<Harness isMultiSelect={isMultiSelect} />);
      await user.click(within(rowOf("北區")).getAllByText("北區")[0]);
      expect(screen.getByTestId("value").textContent).toBe("org-a");
    },
  );
});
