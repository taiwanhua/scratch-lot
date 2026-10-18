import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoot } from "react-dom/client";

import { Checkbox } from "../Checkbox/Checkbox";
import { MenuItem } from "../Menu/MenuItem";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("renders without crashing", () => {
    expect(() => {
      const div = document.createElement("div");
      const root = createRoot(div);
      root.render(<TextField label="食譜名稱" />);
      root.unmount();
    }).not.toThrow();
  });

  /**
   * 有浮動標籤的下拉(Figma 資料範圍的「欄位 / 條件 / 值」)用 `TextField select` 就成立 —
   * `Select` 是行內的下拉本體,標籤要靠 `FormControl` + `InputLabel`,而 `TextField` 已經把那組包好了。
   * 多選一樣走這條路:`slotProps.select` 直通 MUI 的 `Select`。
   */
  it("select + 多選:浮動標籤照掛,選取回傳整個陣列", () => {
    const handleChange = jest.fn();
    const selected = ["org-1"];

    render(
      <TextField
        select
        label="套用對象"
        value={selected}
        onChange={(event) => handleChange(event.target.value)}
        slotProps={{
          select: {
            multiple: true,
            renderValue: () => `已選 ${String(selected.length)} 個組織`,
          },
        }}
      >
        <MenuItem value="org-1">
          <Checkbox checked />
          台北分店
        </MenuItem>
        <MenuItem value="org-2">
          <Checkbox checked={false} />
          高雄分店
        </MenuItem>
      </TextField>,
    );

    // label 本體 + notched outline 的 legend 各一份
    expect(screen.getAllByText("套用對象").length).toBeGreaterThan(0);
    expect(screen.getByText("已選 1 個組織")).not.toBeNull();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "高雄分店" }));

    expect(handleChange.mock.calls[0]?.[0]).toEqual(["org-1", "org-2"]);
  });
});
