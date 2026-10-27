import { useTranslations } from "use-intl";

import {
  TICKET_EVENT_TYPE,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import type {
  LotteryInventoryBookDetailFieldsFragment,
  LotteryInventoryPlaceFieldsFragment,
} from "@repo/graphql";
import { Table, type TableColumn } from "@repo/ui/table";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useLotteryFieldOptions } from "@/hooks/project/useLotteryFieldOptions/useLotteryFieldOptions";

import { TIMELINE_TABLE_MIN_WIDTH } from "../inventory-config";

type Event = LotteryInventoryBookDetailFieldsFragment["events"][number];
type Place = LotteryInventoryPlaceFieldsFragment;

export interface BookTimelineProps {
  events: readonly Event[];
}

/** 兩個地方一樣(同一家店、同一個位置與收銀點)。 */
const samePlace = (a: Place, b: Place): boolean =>
  a.org.id === b.org.id &&
  a.locationKind === b.locationKind &&
  (a.cashPoint?.id ?? null) === (b.cashPoint?.id ?? null);

/**
 * 事件時間軸(Figma IN-03;規格 7.2、7.3):時間、事件(含原因)、張(整本 / 區段)、位置(從 → 到)、
 * 人 / 單據(有單號顯示單號,否則顯示操作的人)。新的在上。
 */
export const BookTimeline = ({ events }: BookTimelineProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const temporal = useTemporalText();
  const skipReasons = useLotteryFieldOptions(
    LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason,
  );
  const recoverReasons = useLotteryFieldOptions(
    LOTTERY_FIELD_CATEGORY_KEYS.recoverReason,
  );
  const scrapReasons = useLotteryFieldOptions(
    LOTTERY_FIELD_CATEGORY_KEYS.scrapReason,
  );
  const reasonLabelOf = (event: Event): string | null => {
    if (event.reasonKey == null) {
      return null;
    }
    switch (event.type) {
      case TICKET_EVENT_TYPE.skip:
      case TICKET_EVENT_TYPE.unskip: {
        return skipReasons.labelOf(event.reasonKey);
      }
      case TICKET_EVENT_TYPE.recover: {
        return recoverReasons.labelOf(event.reasonKey);
      }
      case TICKET_EVENT_TYPE.scrap: {
        return scrapReasons.labelOf(event.reasonKey);
      }
      default: {
        return event.reasonKey;
      }
    }
  };
  const placeLabel = (place: Place) =>
    place.cashPoint?.name ?? t(`locations.${place.locationKind}`);
  const routeText = (event: Event): string => {
    const { from, to } = event;
    if (from == null) {
      return `${to.org.name} ${placeLabel(to)}`;
    }
    if (samePlace(from, to)) {
      return t("stock.none");
    }
    if (from.org.id !== to.org.id) {
      return `${from.org.name} ${placeLabel(from)} → ${to.org.name} ${placeLabel(to)}`;
    }
    return `${placeLabel(from)} → ${placeLabel(to)}`;
  };

  const columns: TableColumn<Event>[] = [
    {
      key: "at",
      header: t("timeline.columns.at"),
      render: (event) => temporal(event.at, "monthDayTime"),
    },
    {
      key: "type",
      header: t("timeline.columns.type"),
      render: (event) => {
        // 拆過的本再放上檯面:同一種「拆本」事件,第一次之後寫「上檯面」
        const label = event.reopen
          ? t("eventTypes.reopen")
          : t(`eventTypes.${event.type}`);
        const reason = reasonLabelOf(event);
        const note = event.reasonNote ? `:${event.reasonNote}` : "";
        // 跨班更正:標「前期更正,屬於 X 班」(撤銷看原售出那一班、事後更正看它指向的班)
        const correction =
          event.correctionOfShift == null
            ? ""
            : t("timeline.correctionOf", { shift: event.correctionOfShift });
        return reason === null
          ? `${label}${correction}`
          : `${label}(${reason}${note})${correction}`;
      },
    },
    {
      key: "tickets",
      header: t("timeline.columns.tickets"),
      render: (event) =>
        event.wholeBook
          ? t("timeline.wholeBook")
          : formatTicketRanges(event.ticketNos),
    },
    {
      key: "route",
      header: t("timeline.columns.route"),
      render: routeText,
    },
    {
      key: "by",
      header: t("timeline.columns.by"),
      render: (event) => event.refSerialNo ?? event.by?.name ?? "",
    },
  ];
  return (
    <Table
      aria-label={t("timeline.aria")}
      columns={columns}
      rows={events}
      getRowKey={(event) =>
        `${event.at}:${event.type}:${event.ticketNos.join(",")}`
      }
      emptyMessage={t("timeline.empty")}
      minWidth={TIMELINE_TABLE_MIN_WIDTH}
      containerSx={{ maxHeight: 480 }}
    />
  );
};
