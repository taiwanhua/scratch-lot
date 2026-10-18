import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { Tag } from "../Tag/Tag";
import { Typography } from "../Typography/Typography";
import { Tree, type TreeNode } from "./Tree";

/** 權限矩陣列在名稱右邊的權限 key(Figma 172:281:12px、text.disabled)。 */
const MatrixKey = ({ value }: { value: string }) => (
  <Typography variant="caption" color="text.disabled">
    {value}
  </Typography>
);

/** 頂層群組列的列尾:狀態說明 + 整組操作(Figma 172:283 / 172:284)。 */
const MatrixActions = () => (
  <>
    <Typography variant="caption" color="text.secondary">
      有下層被勾選,不可取消
    </Typography>
    <Button size="small" variant="text">
      清空整組
    </Button>
  </>
);

const items: TreeNode[] = [
  {
    id: "root",
    label: "平台根組織",
    children: [
      {
        id: "org-1",
        label: "台北分店",
        children: [
          { id: "org-1-1", label: "內場" },
          { id: "org-1-2", label: "外場" },
        ],
      },
      { id: "org-2", label: "高雄分店" },
      { id: "org-3", label: "台中分店(可見範圍外)", disabled: true },
    ],
  },
];

const meta = {
  title: "Components/Tree",
  component: Tree,
  args: {
    items,
    defaultExpandedIds: ["root", "org-1"],
    "aria-label": "組織樹",
  },
} satisfies Meta<typeof Tree>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 選取模式(單選):組織管理頁的主樹。
 * 點文字只選取;**展開 / 收合只認名稱前面的箭頭**(`expansionTrigger="iconContainer"`)。
 */
export const SingleSelect: Story = {
  args: { defaultSelectedIds: ["org-1"] },
};

/** 選取模式(多選) */
export const MultiSelect: Story = {
  args: { multiSelect: true, defaultSelectedIds: ["org-1-1", "org-2"] },
};

/** 勾選模式:選擇所屬組織彈窗 */
export const CheckboxSelection: Story = {
  args: {
    checkboxSelection: true,
    multiSelect: true,
    defaultSelectedIds: ["org-2"],
  },
};

/** 標籤槽位:停用的組織在名稱右側掛一個 `Tag`(Figma Draft/OrgTreeItem 的 ShowTag) */
export const WithLabelSuffix: Story = {
  args: {
    items: [
      {
        id: "root",
        label: "平台根組織",
        children: [
          {
            id: "org-1",
            label: "台北分店",
            labelSuffix: <Tag tone="grey" label="租戶" />,
          },
          {
            id: "org-2",
            label: "高雄分店",
            labelSuffix: <Tag tone="error" label="停用" />,
          },
        ],
      },
    ],
  },
};

/**
 * 三態 + 列尾操作 + 勾選框停用:角色管理的權限矩陣(Figma Screen / Admin 角色管理 57:142)。
 * 連動規則由呼叫端算(`@repo/domain/permission`),這裡只是把算好的結果餵進來:
 * 群組列部分勾選 → `indeterminateIds`;有子孫被勾的上層不可取消 → `disabledCheckIds`;
 * 「全選整組 / 清空整組」放節點的 `actions`。縮排照 Figma 的 24。
 */
export const PermissionMatrix: Story = {
  args: {
    items: [
      {
        id: "demo",
        label: "示範群組",
        labelSuffix: <MatrixKey value="demo" />,
        actions: <MatrixActions />,
        children: [
          {
            id: "demo.sample-one",
            label: "示範模組1",
            labelSuffix: <MatrixKey value="demo.sample-one" />,
            children: [
              {
                id: "demo.sample-one.*",
                label: "全部(*)",
                labelSuffix: <MatrixKey value="demo.sample-one.*" />,
              },
              {
                id: "demo.sample-one.view",
                label: "檢視",
                labelSuffix: <MatrixKey value="demo.sample-one.view" />,
              },
              {
                id: "demo.sample-one.create",
                label: "新增",
                labelSuffix: <MatrixKey value="demo.sample-one.create" />,
              },
            ],
          },
          {
            id: "demo.sample-two",
            label: "示範模組2",
            labelSuffix: <MatrixKey value="demo.sample-two" />,
          },
        ],
      },
      {
        id: "ads-manager",
        label: "廣告管理",
        labelSuffix: <MatrixKey value="ads-manager" />,
        disabled: true,
      },
    ],
    checkboxSelection: true,
    multiSelect: true,
    childrenIndentation: 24,
    defaultExpandedIds: ["demo", "demo.sample-one"],
    selectedIds: ["demo", "demo.sample-one", "demo.sample-one.view"],
    indeterminateIds: ["demo.sample-one"],
    disabledCheckIds: ["demo", "demo.sample-one"],
    "aria-label": "權限矩陣",
  },
};

/**
 * 依深度縮排:每一層的縮排 = `childrenIndentation` × 深度,做在內容列的
 * `paddingLeft` 上。四層一起看最容易發現縮排又被蓋掉。
 */
export const DeepIndentation: Story = {
  args: {
    items: [
      {
        id: "L0",
        label: "第 0 層",
        children: [
          {
            id: "L1",
            label: "第 1 層",
            children: [
              {
                id: "L2",
                label: "第 2 層",
                children: [{ id: "L3", label: "第 3 層" }],
              },
            ],
          },
        ],
      },
    ],
    childrenIndentation: 24,
    defaultExpandedIds: ["L0", "L1", "L2"],
  },
};

export const Collapsed: Story = { args: { defaultExpandedIds: [] } };

export const Loading: Story = { args: { isLoading: true } };
