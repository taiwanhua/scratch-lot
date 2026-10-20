import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  type GameStatus,
  isGameStatus,
  standardTicketsPerBook,
} from "@repo/domain/project/lottery-master-data";
import {
  type LotteryGameFieldsFragment,
  useCreateLotteryGameMutation,
  useLotteryGameQuery,
  useLotteryGamesQuery,
  useUpdateLotteryGameMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import type { TagPaletteKey } from "@/lib/project/tag-palettes";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import {
  type MasterDataErrorCode,
  masterDataErrorOf,
} from "../master-data-error";

/** 表單欄位(= api `VALIDATION_FAILED` 的 `fields`)。 */
export type GameFormField =
  | "gameCode"
  | "name"
  | "status"
  | "unitPrice"
  | "ticketsPerBook"
  | "defaultRate"
  | "launchedAt"
  | "discontinuedAt"
  | "claimDeadline"
  | "color"
  | "note";

export interface GameFormValues {
  gameCode: string;
  name: string;
  status: GameStatus;
  /** 輸入中的字串;送出時轉整數 */
  unitPrice: string;
  ticketsPerBook: string;
  defaultRate: string;
  /** `YYYY-MM-DD`(租戶時區);null = 沒填 */
  launchedAt: string | null;
  discontinuedAt: string | null;
  claimDeadline: string | null;
  color: TagPaletteKey | null;
  note: string;
}

const DATE_FIELDS = ["launchedAt", "discontinuedAt", "claimDeadline"] as const;
const INTEGER_FIELDS = ["unitPrice", "ticketsPerBook", "defaultRate"] as const;

const integerOf = (raw: string): number | null => {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(value) ? value : null;
};

const valuesOf = (
  game: LotteryGameFieldsFragment | null,
  timezone: string,
): GameFormValues =>
  game === null
    ? {
        gameCode: "",
        name: "",
        status: "on_sale",
        unitPrice: "",
        ticketsPerBook: "",
        defaultRate: "",
        launchedAt: null,
        discontinuedAt: null,
        claimDeadline: null,
        color: null,
        note: "",
      }
    : {
        gameCode: game.gameCode,
        name: game.name,
        status: isGameStatus(game.status) ? game.status : "on_sale",
        unitPrice: String(game.unitPrice),
        ticketsPerBook: String(game.ticketsPerBook),
        defaultRate: String(game.defaultRate),
        launchedAt: localDayTextOf(game.launchedAt, timezone),
        discontinuedAt: localDayTextOf(game.discontinuedAt, timezone),
        claimDeadline: localDayTextOf(game.claimDeadline, timezone),
        color: isTagPaletteKey(game.color) ? game.color : null,
        note: game.note ?? "",
      };

/** 送出前的檢查:必填與整數(範圍、格式、唯一由 api 判,錯誤標回欄位)。 */
const invalidFieldsOf = (values: GameFormValues): GameFormField[] => {
  const invalid: GameFormField[] = [];
  if (values.gameCode.trim() === "") invalid.push("gameCode");
  if (values.name.trim() === "") invalid.push("name");
  for (const field of INTEGER_FIELDS) {
    if (integerOf(values[field]) === null) invalid.push(field);
  }
  return invalid;
};

/**
 * 遊戲新增 / 編輯頁的表單狀態與送出(初始值只取一次,REACT-08)。
 * 選預設面額自動帶入張數(`@repo/domain` 的對照表);編輯只送改過的欄位(GQL-06,清空送 null)。
 */
export const useGameForm = (
  game: LotteryGameFieldsFragment | null,
  onSaved: (id: string) => void,
) => {
  const t = useTranslations("admin.lotteryMasterData");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [initial] = useState(() => valuesOf(game, timezone));
  const [values, setValues] = useState(initial);
  const [invalidFields, setInvalidFields] = useState<GameFormField[]>([]);
  const [errorCode, setErrorCode] = useState<MasterDataErrorCode | null>(null);

  const onError = (error: unknown) => {
    const parsed = masterDataErrorOf(error);
    setErrorCode(parsed.code);
    setInvalidFields(
      (parsed.fields ?? []).filter((field): field is GameFormField =>
        Object.hasOwn(initial, field),
      ),
    );
  };
  const onSuccess = (item: LotteryGameFieldsFragment) => {
    queryClient.setQueryData(useLotteryGameQuery.getKey({ id: item.id }), {
      lotteryGame: { item },
    });
    void queryClient.invalidateQueries({
      queryKey: useLotteryGamesQuery.getKey({ input: {} }).slice(0, 1),
    });
    onSaved(item.id);
  };
  const feedbackError = (error: unknown) =>
    t(`errors.${masterDataErrorOf(error).code}`);
  const create = useCreateLotteryGameMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.createSuccess"),
      error: feedbackError,
      onSuccess: (data) => {
        onSuccess(data.createLotteryGame.item);
      },
      onError,
    }),
  );
  const update = useUpdateLotteryGameMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error: feedbackError,
      onSuccess: (data) => {
        onSuccess(data.updateLotteryGame.item);
      },
      onError,
    }),
  );

  const change = <Key extends keyof GameFormValues>(
    key: Key,
    value: GameFormValues[Key],
  ) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      // 選了預設面額 → 自動帶入整本張數(可再改)
      if (key === "unitPrice") {
        const standard = standardTicketsPerBook(Number(value));
        if (standard !== null) {
          next.ticketsPerBook = String(standard);
        }
      }
      return next;
    });
    setInvalidFields((current) => current.filter((field) => field !== key));
  };

  const inputOf = () => {
    const all = {
      gameCode: values.gameCode.trim(),
      name: values.name.trim(),
      status: values.status,
      unitPrice: integerOf(values.unitPrice) ?? 0,
      ticketsPerBook: integerOf(values.ticketsPerBook) ?? 0,
      defaultRate: integerOf(values.defaultRate) ?? 0,
      color: values.color,
      note: values.note.trim() === "" ? null : values.note.trim(),
      ...Object.fromEntries(
        DATE_FIELDS.map((field) => [
          field,
          localDayInstantOf(values[field], timezone),
        ]),
      ),
    };
    if (game === null) {
      return all;
    }
    // 編輯:只送改過的欄位(有庫存時鎖定的三欄沒動就不送)
    return Object.fromEntries(
      Object.entries(all).filter(
        ([key]) =>
          values[key as keyof GameFormValues] !==
          initial[key as keyof GameFormValues],
      ),
    );
  };

  const submit = () => {
    const invalid = invalidFieldsOf(values);
    setInvalidFields(invalid);
    setErrorCode(null);
    if (invalid.length > 0) {
      return;
    }
    const input = inputOf();
    if (game === null) {
      create.mutate({
        input: input as Parameters<typeof create.mutate>[0]["input"],
      });
    } else {
      update.mutate({ input: { id: game.id, ...input } });
    }
  };

  const isDirty = (Object.keys(initial) as (keyof GameFormValues)[]).some(
    (key) => values[key] !== initial[key],
  );

  return {
    values,
    change,
    invalidFields,
    errorCode,
    isDirty,
    isSubmitting: create.isPending || update.isPending,
    submit,
  };
};
