import type { Meta, StoryObj } from "@storybook/react-vite";

import { Autocomplete } from "./Autocomplete";

interface Role {
  id: string;
  name: string;
  ownerOrg: string;
  tenant: string;
  eligible: boolean;
}

/** Figma `Draft/Autocomplete` 253:39 的示範資料:兩個租戶、各有一個同名的「租戶管理員」。 */
const tenantAdminA: Role = {
  id: "a-admin",
  name: "租戶管理員",
  ownerOrg: "好食公司",
  tenant: "好食公司",
  eligible: true,
};
const nangang: Role = {
  id: "a-nangang",
  name: "南港店管理員",
  ownerOrg: "南港店",
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
const storeManager: Role = {
  id: "b-store",
  name: "門市主管",
  ownerOrg: "美味餐飲",
  tenant: "美味餐飲",
  eligible: false,
};
const roles: readonly Role[] = [
  tenantAdminA,
  nangang,
  support,
  tenantAdminB,
  storeManager,
];

const meta = {
  title: "Components/Autocomplete",
  component: Autocomplete<Role, false>,
  args: {
    label: "角色",
    options: roles,
    value: null,
    getOptionLabel: (role: Role) => role.name,
    getOptionKey: (role: Role) => role.id,
    getOptionSecondaryText: (role: Role) => role.ownerOrg,
    noOptionsText: "沒有符合的角色",
    sx: { width: 320 },
    onChange: () => {
      // 受控元件:story 只看外觀,不真的換值
    },
  },
} satisfies Meta<typeof Autocomplete<Role, false>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 單選,收合態(Figma 253:2 State=Closed)。 */
export const Default: Story = {};

export const Selected: Story = { args: { value: support } };

export const WithError: Story = {
  args: { error: true, helperText: "請選一個角色" },
};

export const Disabled: Story = { args: { value: support, disabled: true } };

/** 資料還在路上時列一行「載入中」,而不是「沒有符合的角色」。 */
export const Loading: Story = {
  args: { options: [], loading: true, loadingText: "載入中" },
};

type MultiStory = StoryObj<typeof Autocomplete<Role, true>>;

/**
 * 多選 + 依租戶頂層分組 + 不合格選項灰掉(Figma 253:12 State=Open)。
 * 這就是資料範圍「指定角色」與指派角色彈窗實際用的組合。
 */
export const MultipleGrouped: MultiStory = {
  args: {
    multiple: true,
    value: [nangang],
    groupBy: (role: Role) => role.tenant,
    getOptionDisabled: (role: Role) => !role.eligible,
    getOptionDisabledReason: () => "使用者不在此角色的擁有組織之下",
  },
};

type FreeSoloStory = StoryObj<typeof Autocomplete<string, false, true>>;

/**
 * 可自填(`freeSolo`):選項只是建議,打的字本身就是值。
 * 呼叫端用 `inputValue` + `onInputChange` 受控,打字即值。
 */
export const FreeSolo: FreeSoloStory = {
  args: {
    freeSolo: true,
    label: "金額",
    options: ["100", "200", "500", "1000"],
    value: "250",
    inputValue: "250",
    inputMode: "numeric",
    getOptionLabel: (price: string) => price,
    getOptionKey: undefined,
    getOptionSecondaryText: undefined,
    noOptionsText: undefined,
  },
};
