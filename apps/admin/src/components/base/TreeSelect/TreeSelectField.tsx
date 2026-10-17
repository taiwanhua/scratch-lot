import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { ChevronDownIcon } from "@repo/ui/icons";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";

/**
 * 欄位上的一個已選項目。樹上找不到的 id(組織:管理範圍外;權限:已不在操作者持有的權限裡)
 * 由呼叫端換好顯示文字,一樣列成可取消的標籤。
 */
export interface TreeSelectFieldItem {
  id: string;
  name: string;
}

export interface TreeSelectFieldProps {
  label: string;
  /** 已選的項目(依 `value` 的順序) */
  selected: readonly TreeSelectFieldItem[];
  isMultiSelect: boolean;
  isOpen: boolean;
  helperText?: ReactNode;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  /** 打開面板;錨點是欄位外框 */
  onOpen: (anchor: HTMLElement) => void;
  /** 多選標籤的 ×:取消這一個 */
  onRemove: (id: string) => void;
}

const OPEN_KEYS = new Set(["Enter", " ", "ArrowDown"]);

/**
 * 樹狀選擇器收合時的欄位(`OrgTreeSelect`、人員條件的 `PermissionTreeSelect` 共用):
 * 外觀同 SelectField(浮動標籤 + 外框 + 右側箭頭)。單選顯示名稱;多選以 `Tag` 列出已選項目,
 * 每個標籤可 × 取消(停用 / 樹上找不到的也能取消)。欄位本身唯讀,點擊或 Enter / 空白 / ↓ 打開面板。
 */
export const TreeSelectField = ({
  label,
  selected,
  isMultiSelect,
  isOpen,
  helperText,
  error,
  required,
  disabled = false,
  fullWidth,
  size,
  onOpen,
  onRemove,
}: TreeSelectFieldProps) => {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!disabled) {
      onOpen(event.currentTarget);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!disabled && OPEN_KEYS.has(event.key)) {
      event.preventDefault();
      onOpen(event.currentTarget);
    }
  };

  const tags =
    isMultiSelect && selected.length > 0 ? (
      <Box
        component="span"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          flex: "1 1 auto",
          minWidth: 0,
          gap: 0.5,
          py: 1,
        }}
      >
        {selected.map((item) => (
          <Tag
            key={item.id}
            label={item.name}
            disabled={disabled}
            onDelete={(event: MouseEvent) => {
              // × 只取消這一個,不要外溢成「點欄位 → 打開面板」
              event.stopPropagation();
              onRemove(item.id);
            }}
          />
        ))}
      </Box>
    ) : undefined;

  return (
    <TextField
      label={label}
      value={isMultiSelect ? "" : (selected[0]?.name ?? "")}
      helperText={helperText}
      error={error}
      required={required}
      disabled={disabled}
      fullWidth={fullWidth}
      size={size}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      slotProps={{
        input: {
          readOnly: true,
          startAdornment: tags,
          endAdornment: (
            <ChevronDownIcon fontSize="small" sx={{ color: "action.active" }} />
          ),
          sx: { cursor: disabled ? undefined : "pointer" },
        },
        htmlInput: {
          role: "combobox",
          "aria-haspopup": "tree",
          "aria-expanded": isOpen,
          sx: {
            cursor: disabled ? undefined : "pointer",
            // 多選有標籤時輸入框只是焦點載體,寬度讓給標籤(標籤自己換行,箭頭固定在右側)
            ...(isMultiSelect && selected.length > 0
              ? { width: 0, minWidth: 0, paddingInline: 0 }
              : {}),
          },
        },
      }}
    />
  );
};
