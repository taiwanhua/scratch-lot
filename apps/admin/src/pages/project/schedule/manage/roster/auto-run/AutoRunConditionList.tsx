import { type KeyboardEvent, useState } from "react";

import { Box } from "@repo/ui/box";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";

import { movedItem } from "@/lib/project/schedule-auto-run";

export interface AutoRunCondition {
  key: string;
  label: string;
  enabled: boolean;
}

export interface AutoRunConditionListProps {
  /** 依目前的順序 */
  conditions: readonly AutoRunCondition[];
  onChange: (conditions: AutoRunCondition[]) => void;
  /** 拖拉把手的無障礙名稱 */
  handleLabel: (label: string) => string;
}

/**
 * 自動排班條件(SC-20a;規格 14.5:可勾選、可拖拉排序,依勾選順序比較候選人):每列左邊是拖拉把手
 * (⋮⋮;也可以聚焦後按上下鍵移動),後面是勾選框。
 */
export const AutoRunConditionList = ({
  conditions,
  onChange,
  handleLabel,
}: AutoRunConditionListProps) => {
  const [dragging, setDragging] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    onChange(movedItem(conditions, from, to));
  };
  const onHandleKey = (index: number) => (event: KeyboardEvent) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(index, index - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(index, index + 1);
    }
  };

  return (
    <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {conditions.map((condition, index) => (
        <Stack
          component="li"
          key={condition.key}
          direction="row"
          spacing={0.5}
          sx={{
            alignItems: "center",
            opacity: dragging === index ? 0.5 : 1,
          }}
          onDragOver={(event) => {
            if (dragging === null || dragging === index) {
              return;
            }
            event.preventDefault();
            move(dragging, index);
            setDragging(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(null);
          }}
        >
          <Box
            component="span"
            role="button"
            tabIndex={0}
            draggable
            aria-label={handleLabel(condition.label)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              setDragging(index);
            }}
            onDragEnd={() => {
              setDragging(null);
            }}
            onKeyDown={onHandleKey(index)}
            sx={{
              cursor: "grab",
              color: "text.disabled",
              px: 0.5,
              userSelect: "none",
              letterSpacing: "-0.2em",
            }}
          >
            ⋮⋮
          </Box>
          <FormControlLabel
            label={condition.label}
            control={
              <Checkbox
                checked={condition.enabled}
                onChange={(_event, checked) => {
                  onChange(
                    conditions.map((item) =>
                      item.key === condition.key
                        ? { ...item, enabled: checked }
                        : item,
                    ),
                  );
                }}
              />
            }
          />
        </Stack>
      ))}
    </Stack>
  );
};
