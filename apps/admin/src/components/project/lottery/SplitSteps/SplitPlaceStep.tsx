import { useTranslations } from "use-intl";

import {
  type SplitAssignment,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";

import { type SplitPlaceState, assignTo } from "./split-place";

export interface SplitPlaceStepProps {
  ticketNos: readonly string[];
  skipped: readonly string[];
  points: readonly { id: string; name: string }[];
  localId: string | null;
  state: SplitPlaceState;
  onChange: (state: SplitPlaceState) => void;
  assignments: readonly SplitAssignment[];
  /**
   * 換掉拆本的文字(期初建檔頁:位置含庫存,寫「位置」不寫「收銀點」);不給 = 拆本精靈的文字。
   * `remaining` 收還沒分配的張數。
   */
  labels?: Partial<SplitPlaceLabels>;
}

/** `SplitPlaceStep` 可以換掉的文字。 */
export interface SplitPlaceLabels {
  allTo: string;
  allToField: string;
  splitOption: string;
  splitHint: string;
  column: string;
  remaining: (count: number) => string;
}

/**
 * 拆本 ② 放到哪個收銀點(店面拆本精靈、期初建檔頁 ③ 分放共用)(Figma ST-09b 全部放到本機收銀點、09c 分放到多個收銀點):分放時在格子選張
 * (跳號反灰不能選),再點收銀點分配;下方表格即時列出各收銀點的張號區段與張數。
 */
export const SplitPlaceStep = ({
  ticketNos,
  skipped,
  points,
  localId,
  state,
  onChange,
  assignments,
  labels = {},
}: SplitPlaceStepProps) => {
  const t = useTranslations("admin.lotteryStore");
  const text: SplitPlaceLabels = {
    allTo: t("split.allTo"),
    allToField: t("split.allToField"),
    splitOption: t("split.splitOption"),
    splitHint: t("split.splitHint"),
    column: t("split.columns.cashPoint"),
    remaining: (count) => t("split.remaining", { count }),
    ...labels,
  };
  const skippedSet = new Set(skipped);
  const usable = ticketNos.filter((no) => !skippedSet.has(no));
  const unassigned = usable.filter((no) => state.assigned[no] === undefined);
  const labelOf = (point: { id: string; name: string }) =>
    point.id === localId
      ? t("split.localOption", { name: point.name })
      : point.name;
  const nameOf = (id: string) =>
    points.find((point) => point.id === id)?.name ?? "";
  const cells: TicketGridCell[] = ticketNos.map((no) => {
    if (skippedSet.has(no)) {
      return { ticketNo: no, state: "skipped" };
    }
    const to = state.assigned[no];
    return to === undefined
      ? { ticketNo: no, state: "unsold" }
      : { ticketNo: no, state: "assigned", tooltip: nameOf(to) };
  });
  const rows = [
    ...assignments
      .filter((row) => row.ticketNos.length > 0)
      .map((row) => ({
        key: row.cashPointId,
        name: nameOf(row.cashPointId),
        nos: row.ticketNos,
      })),
    ...(state.mode === "split" && unassigned.length > 0
      ? [{ key: "unassigned", name: t("split.unassigned"), nos: unassigned }]
      : []),
  ];
  return (
    <Stack spacing={1.5}>
      <RadioGroup
        value={state.mode}
        onChange={(event) => {
          onChange({
            ...state,
            mode: event.target.value === "split" ? "split" : "all",
          });
        }}
      >
        <FormControlLabel value="all" control={<Radio />} label={text.allTo} />
        {state.mode === "all" ? (
          <Box sx={{ pl: 4, maxWidth: 280 }}>
            <SelectField
              label={text.allToField}
              value={state.allTo}
              size="small"
              fullWidth
              options={points.map((point) => ({
                value: point.id,
                label: labelOf(point),
              }))}
              onChange={(value: string) => {
                onChange({ ...state, allTo: value });
              }}
            />
          </Box>
        ) : null}
        <FormControlLabel
          value="split"
          control={<Radio />}
          label={text.splitOption}
        />
      </RadioGroup>
      {state.mode === "split" ? (
        <>
          <Typography variant="body2">{text.splitHint}</Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            {points.map((point) => (
              <Button
                key={point.id}
                size="small"
                variant="outlined"
                disabled={state.selected.length === 0}
                onClick={() => {
                  onChange(assignTo(state, point.id));
                }}
              >
                {labelOf(point)}
              </Button>
            ))}
          </Stack>
          <TicketGrid
            cells={cells}
            selectableStates={["unsold"]}
            selected={state.selected}
            onSelectedChange={(selected) => {
              onChange({ ...state, selected });
            }}
            legendItems={["unsold", "assigned", "skipped", "selected"]}
            labels={{
              unsold: t("split.legendUnassigned"),
              assigned: t("split.legendAssigned"),
            }}
          />
        </>
      ) : null}
      <Box
        component="table"
        sx={{ width: "100%", borderCollapse: "collapse", typography: "body2" }}
      >
        <thead>
          <tr>
            <Box component="th" sx={{ textAlign: "left", py: 0.5 }}>
              {text.column}
            </Box>
            <Box component="th" sx={{ textAlign: "left", py: 0.5 }}>
              {t("split.columns.ticketNos")}
            </Box>
            <Box component="th" sx={{ textAlign: "right", py: 0.5 }}>
              {t("split.columns.count")}
            </Box>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <Box component="td" sx={{ py: 0.5 }}>
                {row.name}
              </Box>
              <Box component="td" sx={{ py: 0.5 }}>
                {formatTicketRanges(row.nos)}
              </Box>
              <Box component="td" sx={{ py: 0.5, textAlign: "right" }}>
                {row.nos.length}
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
      {state.mode === "split" && unassigned.length > 0 ? (
        <Typography variant="body2" color="warning">
          {text.remaining(unassigned.length)}
        </Typography>
      ) : null}
    </Stack>
  );
};
