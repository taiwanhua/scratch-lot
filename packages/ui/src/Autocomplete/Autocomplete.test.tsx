import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Autocomplete } from "./Autocomplete";

interface Role {
  id: string;
  name: string;
  ownerOrg: string;
  tenant: string;
  eligible: boolean;
}

/** 兩個租戶各有一個同名的「租戶管理員」—— 這個元件存在的理由就是分得出這兩列。 */
const tenantAdminA: Role = {
  id: "a-admin",
  name: "租戶管理員",
  ownerOrg: "好食公司",
  tenant: "好食公司",
  eligible: true,
};
const support: Role = {
  id: "a-support",
  name: "客服",
  ownerOrg: "好食公司",
  tenant: "好食公司",
  eligible: true,
};
const tenantAdminB: Role = {
  id: "b-admin",
  name: "租戶管理員",
  ownerOrg: "美味餐飲",
  tenant: "美味餐飲",
  eligible: true,
};
/** 不合格的那一列:列出來但灰掉,並就地說明原因 */
const storeManager: Role = {
  id: "b-store",
  name: "門市主管",
  ownerOrg: "美味餐飲",
  tenant: "美味餐飲",
  eligible: false,
};
const roles: readonly Role[] = [
  tenantAdminA,
  support,
  tenantAdminB,
  storeManager,
];

const labels = () =>
  screen.getAllByRole("option").map((option) => option.textContent);

/** 依主文字取一列;選項是兩行文字(主 + 次),所以不能用 `getByRole` 的完整名稱比對。 */
const optionStartingWith = (name: string): HTMLElement => {
  const found = screen
    .getAllByRole("option")
    .find((option) => option.textContent.startsWith(name));
  if (found === undefined) {
    throw new Error(`找不到主文字是「${name}」的選項`);
  }
  return found;
};

describe("Autocomplete", () => {
  it("輸入即過濾,選一個就回報它(單選)", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={null}
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("combobox", { name: "角色" });
    await user.type(input, "客服");

    expect(labels()).toEqual(["客服"]);
    await user.click(screen.getByRole("option", { name: "客服" }));

    expect(onChange).toHaveBeenCalledWith(support);
  });

  it("每列畫主文字 + 次文字,同名選項靠次文字分辨", async () => {
    const user = userEvent.setup();
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={null}
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        getOptionSecondaryText={(role) => role.ownerOrg}
        onChange={noop}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "角色" }));

    expect(labels()).toEqual([
      "租戶管理員好食公司",
      "客服好食公司",
      "租戶管理員美味餐飲",
      "門市主管美味餐飲",
    ]);
  });

  it("groupBy:分組標題看得到,且不是可選的選項", async () => {
    const user = userEvent.setup();
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={[]}
        multiple
        groupBy={(role) => role.tenant}
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        onChange={noop}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "角色" }));

    expect(screen.getByText("好食公司")).toBeInTheDocument();
    expect(screen.getByText("美味餐飲")).toBeInTheDocument();
    // 組標題是 listbox 裡的標題,不是 option —— 選不到它
    expect(labels()).toEqual(["租戶管理員", "客服", "租戶管理員", "門市主管"]);
  });

  it("multiple:選中的項目變成可移除的 chip,再選一個會累加", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const { rerender } = render(
      <Autocomplete
        label="角色"
        options={roles}
        value={[support]}
        multiple
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("客服")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "角色" }));
    await user.click(optionStartingWith("門市主管"));

    expect(onChange).toHaveBeenCalledWith([support, storeManager]);

    // 移除 chip 也走同一個回報
    onChange.mockClear();
    rerender(
      <Autocomplete
        label="角色"
        options={roles}
        value={[support]}
        multiple
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId("CancelIcon"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("chipDeleteIcon=close:chip 的刪除鈕換成小 ×(同 Tag),點了一樣移除", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={[support]}
        multiple
        chipDeleteIcon="close"
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        onChange={onChange}
      />,
    );

    expect(screen.queryByTestId("CancelIcon")).not.toBeInTheDocument();
    const chip = screen.getByText("客服").closest(".MuiChip-root");
    const icon = chip?.querySelector(".MuiChip-deleteIcon") ?? null;
    if (icon === null) {
      throw new Error("chip 沒有刪除鈕");
    }
    await user.click(icon);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("getOptionDisabled 的選項灰掉、選不下去,並就地寫原因", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={[]}
        multiple
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        getOptionSecondaryText={(role) => role.ownerOrg}
        getOptionDisabled={(role) => !role.eligible}
        getOptionDisabledReason={() => "使用者不在此角色的擁有組織之下"}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "角色" }));
    const blocked = optionStartingWith("門市主管");

    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveTextContent("使用者不在此角色的擁有組織之下");
    // 可以選的那列沒有原因那一行
    expect(optionStartingWith("客服")).not.toHaveTextContent(
      "使用者不在此角色的擁有組織之下",
    );

    // 鍵盤也選不到:MUI 的巡覽會跳過停用的選項,只剩它時按 Enter 不會選中任何東西
    await user.type(
      screen.getByRole("combobox", { name: "角色" }),
      "門市{Enter}",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loading 時列出 loadingText,沒有符合的項目時列出 noOptionsText", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Autocomplete
        label="角色"
        options={[]}
        value={null}
        loading
        loadingText="載入中"
        noOptionsText="沒有符合的角色"
        getOptionLabel={(role: Role) => role.name}
        onChange={noop}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "角色" }));
    expect(screen.getByText("載入中")).toBeInTheDocument();

    rerender(
      <Autocomplete
        label="角色"
        options={[]}
        value={null}
        loadingText="載入中"
        noOptionsText="沒有符合的角色"
        getOptionLabel={(role: Role) => role.name}
        onChange={noop}
      />,
    );
    expect(screen.getByText("沒有符合的角色")).toBeInTheDocument();
  });

  /**
   * keyword 要丟回 api 查的情境(角色管理頁的「加入使用者」):
   * 內建過濾要讓開,否則第一次打字就把還沒換過來的 `options` 濾成空的。
   */
  it("給了 onInputChange 就由呼叫端過濾:回報關鍵字,選項不被前端濾掉", async () => {
    const user = userEvent.setup();
    const onInputChange = jest.fn();
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={[]}
        multiple
        getOptionLabel={(role) => role.name}
        getOptionKey={(role) => role.id}
        onInputChange={onInputChange}
        onChange={noop}
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "角色" }), "客服");

    expect(onInputChange).toHaveBeenLastCalledWith("客服");
    expect(labels()).toHaveLength(roles.length);
  });

  it("disabled 時打不開選單", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <Autocomplete
        label="角色"
        options={roles}
        value={null}
        disabled
        getOptionLabel={(role) => role.name}
        onChange={noop}
      />,
    );

    const input = screen.getByRole("combobox", { name: "角色" });
    expect(input).toBeDisabled();

    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("hiddenLabel:不畫浮動標籤(legend 不留缺口),label 改當輸入框的名稱", () => {
    const { container } = render(
      <Autocomplete<Role>
        label="角色"
        hiddenLabel
        options={[support]}
        value={null}
        getOptionLabel={(role) => role.name}
        onChange={jest.fn()}
      />,
    );

    // 沒有標籤元素、外框的 legend 只剩零寬空白:不留缺口
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector("fieldset legend")?.textContent).toBe(
      "\u200B",
    );
    expect(screen.getByLabelText("角色")).toHaveRole("combobox");
  });
});

/** freeSolo 的典型用法:打的字就是值(`inputValue` + `onInputChange` 受控),選項只是建議。 */
const FreeSoloPrice = ({ onValue }: { onValue: (value: string) => void }) => {
  const [text, setText] = useState("");
  const commit = (next: string) => {
    setText(next);
    onValue(next);
  };
  return (
    <Autocomplete
      freeSolo
      label="單價"
      options={["100", "200", "500"]}
      value={text === "" ? null : text}
      inputValue={text}
      inputMode="numeric"
      getOptionLabel={(price) => price}
      onInputChange={commit}
      onChange={(price) => {
        commit(price ?? "");
      }}
    />
  );
};

describe("Autocomplete freeSolo", () => {
  it("打的字就是值:不在選項裡也收,選單照打的字過濾", async () => {
    const user = userEvent.setup();
    const onValue = jest.fn<(value: string) => void>();
    render(<FreeSoloPrice onValue={onValue} />);

    const input = screen.getByRole("combobox", { name: "單價" });
    expect(input).toHaveAttribute("inputmode", "numeric");
    await user.type(input, "2");
    expect(labels()).toEqual(["200"]);

    await user.type(input, "50");
    expect(input).toHaveValue("250");
    expect(onValue).toHaveBeenLastCalledWith("250");
  });

  it("選預設項:值變成那個選項", async () => {
    const user = userEvent.setup();
    const onValue = jest.fn<(value: string) => void>();
    render(<FreeSoloPrice onValue={onValue} />);

    await user.click(screen.getByRole("combobox", { name: "單價" }));
    await user.click(screen.getByRole("option", { name: "500" }));

    expect(screen.getByRole("combobox", { name: "單價" })).toHaveValue("500");
    expect(onValue).toHaveBeenLastCalledWith("500");
  });

  it("清空:值回到空字串", async () => {
    const user = userEvent.setup();
    const onValue = jest.fn<(value: string) => void>();
    render(<FreeSoloPrice onValue={onValue} />);

    const input = screen.getByRole("combobox", { name: "單價" });
    await user.type(input, "300");
    await user.clear(input);

    expect(input).toHaveValue("");
    expect(onValue).toHaveBeenLastCalledWith("");
  });
});

const noop = () => {
  // 受控元件必給 onChange;這幾個案子不驗回報
};
