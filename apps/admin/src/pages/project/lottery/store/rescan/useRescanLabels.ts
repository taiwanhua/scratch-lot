import type { RescanItem, RescanPlaceView, RescanView } from "./rescan-model";
import { useRescanText } from "./useRescanText";

/** 位置的顯示名稱與結果文字(重刷頁各卡片共用)。 */
export const useRescanLabels = (rescan: RescanView, local: string | null) => {
  const { t, clock } = useRescanText();
  const nameOf = (place: Pick<RescanPlaceView, "cashPointId" | "name">) =>
    place.cashPointId == null ? t("page.stock") : place.name;
  const labelOf = (place: RescanPlaceView) =>
    place.cashPointId != null && place.cashPointId === local
      ? t("page.local", { name: place.name })
      : nameOf(place);
  const stateText = (place: RescanPlaceView): string =>
    place.state === "done"
      ? t("states.done", {
          time: place.doneAt == null ? "" : clock(place.doneAt),
          name: place.doneByName ?? "",
        })
      : t(`states.${place.state}`, { name: place.scanningByName ?? "" });
  const placeNameOf = (cashPointId: string | null | undefined): string =>
    cashPointId == null
      ? t("page.stock")
      : (rescan.places.find((place) => place.cashPointId === cashPointId)
          ?.name ?? "");
  const outcomeText = (item: RescanItem): string =>
    t(`outcomes.${item.outcome}`, {
      code: rescan.gameCode,
      place: placeNameOf(item.cashPointId),
    });
  return { nameOf, labelOf, stateText, outcomeText };
};

export type RescanLabels = ReturnType<typeof useRescanLabels>;
