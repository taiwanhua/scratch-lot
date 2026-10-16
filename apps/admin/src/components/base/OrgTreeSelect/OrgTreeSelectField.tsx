import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { ChevronDownIcon } from "@repo/ui/icons";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";

import type { OrgOption } from "@/lib/base/org-tree";

export interface OrgTreeSelectFieldProps {
  label: string;
  /** 已選的組織(依 `value` 的順序;樹上找不到的 id 不顯示) */
  selected: readonly OrgOption[];
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
 * `OrgTreeSelect` 收合時的欄位:外觀同 SelectField(浮動標籤 + 外框 + 右側箭頭)。
 * 單選顯示組織名稱;多選以 `Tag` 列出已選組織,每個標籤可 × 取消(停用的組織也能取消)。
 * 欄位本身唯讀,點擊或 Enter / 空白 / ↓ 打開面板。
 */
export const OrgTreeSelectField = ({
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
}: OrgTreeSelectFieldProps) => {
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
        {selected.map((org) => (
          <Tag
            key={org.id}
            label={org.name}
            disabled={disabled}
            onDelete={(event: MouseEvent) => {
              // × 只取消這一個,不要外溢成「點欄位 → 打開面板」
              event.stopPropagation();
              onRemove(org.id);
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
