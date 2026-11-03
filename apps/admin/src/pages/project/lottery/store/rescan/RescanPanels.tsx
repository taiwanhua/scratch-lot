import {
  STORE_RESCAN_SCAN_PURPOSE,
  displayBookNo,
} from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag, type TagTone } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { SendReversalButton } from "../forms/SendReversalButton";
import {
  type RescanItem,
  type RescanPlaceView,
  type RescanView,
  placeKeyOf,
  rescanRowsOf,
  rescanSummaryOf,
  ticketLabelOf,
} from "./rescan-model";
import type { RescanLabels } from "./useRescanLabels";
import { useRescanText } from "./useRescanText";

/** 刷到的結果的標籤顏色:沒問題灰;對號、尋回綠;記已售但還在、確定待查黃;要先更正紅;不處理灰。 */
const TONES: Record<string, TagTone> = {
  ok: "grey",
  matched: "success",
  recovered: "success",
  moved: "success",
  sold_here: "warning",
  investigated: "warning",
  skipped: "error",
  scrapped: "error",
  locked: "error",
  unopened: "error",
  other_game: "grey",
  not_this_store: "grey",
};

const ticketsText = (items: readonly RescanItem[]): string =>
  items.map((item) => `#${item.ticketNo}`).join("、");

type Labels = RescanLabels;

/** 左邊:各位置與狀態(還沒刷 / 刷到一半(誰)/ 刷完(幾點、誰))。 */
export const RescanPlacesCard = ({
  rescan,
  labels,
}: {
  rescan: RescanView;
  labels: Labels;
}) => {
  const { t } = useRescanText();
  return (
    <Card sx={{ px: { xs: 2, sm: 2.5 }, py: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h2" color="textSecondary">
          {t("page.placesTitle")}
        </Typography>
        {rescan.places.map((place) => (
          <Stack
            key={placeKeyOf(place.cashPointId)}
            direction="row"
            spacing={2}
            sx={{ justifyContent: "space-between" }}
          >
            <Typography variant="body2" color="textSecondary">
              {labels.labelOf(place)}
            </Typography>
            <Typography variant="body1" sx={{ textAlign: "right" }}>
              {labels.stateText(place)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
};

/** 刷到的一張:張號、結果標籤;記已售但還在的 [送撤銷售出申請]。 */
const ItemRow = ({
  item,
  orgId,
  labels,
}: {
  item: RescanItem;
  orgId: string;
  labels: Labels;
}) => (
  <Stack
    direction={{ xs: "column", sm: "row" }}
    spacing={1}
    sx={{ alignItems: { sm: "center" } }}
  >
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flex: 1, flexWrap: "wrap", rowGap: 0.5 }}
    >
      <Typography variant="body1" color="textSecondary">
        {ticketLabelOf(item)}
      </Typography>
      <Tag
        tone={TONES[item.outcome] ?? "grey"}
        label={labels.outcomeText(item)}
      />
    </Stack>
    {item.outcome === "sold_here" ? (
      <Box>
        <SendReversalButton ticketId={item.ticketId} orgId={orgId} />
      </Box>
    ) : null}
  </Stack>
);

export interface RescanScanCardProps {
  orgId: string;
  rescan: RescanView;
  current: RescanPlaceView;
  placeKey: string;
  labels: Labels;
  text: string;
  message: string | null;
  isScanning: boolean;
  onPlace: (key: string) => void;
  onText: (text: string) => void;
  onAdd: () => void;
  onCamera: () => void;
  onFinish: () => void;
}

/** 右邊(進行中):現在刷哪個位置、刷條碼 / 相機 / 手輸張號、刷到的結果、[這裡刷完了](CS-10b)。 */
export const RescanScanCard = ({
  orgId,
  rescan,
  current,
  placeKey,
  labels,
  text,
  message,
  isScanning,
  onPlace,
  onText,
  onAdd,
  onCamera,
  onFinish,
}: RescanScanCardProps) => {
  const { t } = useRescanText();
  return (
    <Card sx={{ px: { xs: 2, sm: 2.5 }, py: 2.5 }}>
      <Stack spacing={1.75}>
        <Typography variant="subtitle1" component="h2" color="textSecondary">
          {t("page.current", { place: labels.nameOf(current) })}
        </Typography>
        <SelectField
          label={t("page.pickPlace")}
          value={placeKey}
          fullWidth
          options={rescan.places.map((place) => ({
            value: placeKeyOf(place.cashPointId),
            label: labels.labelOf(place),
            disabled: place.state === "done",
          }))}
          onChange={onPlace}
        />
        <Typography variant="body2" color="textSecondary">
          {t("page.placeHint")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <TextField
            label={t("page.input")}
            size="small"
            value={text}
            error={message !== null}
            helperText={message ?? undefined}
            slotProps={{
              htmlInput: { "data-scanner-field": STORE_RESCAN_SCAN_PURPOSE },
            }}
            onChange={(event) => {
              onText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onAdd();
              }
            }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            disabled={isScanning || text.trim() === ""}
            onClick={onAdd}
          >
            {t("page.add")}
          </Button>
          <Button variant="text" onClick={onCamera}>
            {t("page.camera")}
          </Button>
        </Stack>
        <Typography variant="body2" color="textSecondary">
          {t("page.scannedCount", { count: current.scannedCount })}
        </Typography>
        <Stack spacing={1.25}>
          {rescanRowsOf(current.items).map((row) =>
            row.kind === "item" ? (
              <ItemRow
                key={row.item.ticketId}
                item={row.item}
                orgId={orgId}
                labels={labels}
              />
            ) : (
              <Stack
                key={row.key}
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}
              >
                <Typography variant="body1" color="textSecondary">
                  {`${row.gameCode} · ${displayBookNo(row.bookNo)} · #${t(
                    "page.okRange",
                    { first: row.first, last: row.last, count: row.count },
                  )}`}
                </Typography>
                <Tag tone="grey" label={t("outcomes.ok")} />
              </Stack>
            ),
          )}
        </Stack>
        <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
          <Button variant="contained" onClick={onFinish}>
            {t("page.finishPlace")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};

/** 右邊(結束後):結果摘要(已對號、已尋回、記已售但還在、確定待查、要先更正;CS-10d)。 */
export const RescanSummaryCard = ({
  orgId,
  rescan,
  labels,
  onLeave,
}: {
  orgId: string;
  rescan: RescanView;
  labels: Labels;
  onLeave: () => void;
}) => {
  const { t } = useRescanText();
  const summary = rescanSummaryOf(rescan.results);
  const withOutcome = (items: readonly RescanItem[]) =>
    items
      .map((item) => `#${item.ticketNo} ${labels.outcomeText(item)}`)
      .join("、");
  const valueOf = (items: readonly RescanItem[], value: () => string) =>
    items.length === 0 ? t("done.none") : value();
  const rows = [
    {
      key: "matched",
      label: t("done.matched"),
      value: valueOf(summary.matched, () =>
        t("done.matchedValue", { count: summary.matched.length }),
      ),
    },
    {
      key: "recovered",
      label: t("done.recovered"),
      value: valueOf(summary.recovered, () =>
        t("done.countValue", {
          count: summary.recovered.length,
          tickets: withOutcome(summary.recovered),
        }),
      ),
    },
    {
      key: "soldHere",
      label: t("done.soldHere"),
      value: valueOf(summary.soldHere, () =>
        t("done.soldHereValue", {
          count: summary.soldHere.length,
          tickets: ticketsText(summary.soldHere),
        }),
      ),
    },
    {
      key: "investigated",
      label: t("done.investigated"),
      value: valueOf(summary.investigated, () =>
        t("done.countValue", {
          count: summary.investigated.length,
          tickets: ticketsText(summary.investigated),
        }),
      ),
    },
    {
      key: "toFix",
      label: t("done.toFix"),
      value: valueOf(summary.toFix, () =>
        t("done.countValue", {
          count: summary.toFix.length,
          tickets: withOutcome(summary.toFix),
        }),
      ),
    },
  ];
  return (
    <Card sx={{ px: { xs: 2, sm: 2.5 }, py: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h2" color="textSecondary">
          {t("done.summaryTitle")}
        </Typography>
        {rows.map((row) => (
          <Stack
            key={row.key}
            direction="row"
            spacing={2}
            sx={{ justifyContent: "space-between" }}
          >
            <Typography variant="body2" color="textSecondary">
              {row.label}
            </Typography>
            <Typography variant="body1" sx={{ textAlign: "right" }}>
              {row.value}
            </Typography>
          </Stack>
        ))}
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ justifyContent: "flex-end", flexWrap: "wrap", rowGap: 1 }}
        >
          {summary.soldHere.map((item) => (
            <SendReversalButton
              key={item.ticketId}
              ticketId={item.ticketId}
              orgId={orgId}
            />
          ))}
          <Button variant="contained" onClick={onLeave}>
            {t("page.backToBoard")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
