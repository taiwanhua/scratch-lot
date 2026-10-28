import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  localDateText,
  parseLocalDate,
} from "@repo/domain/form";
import {
  type GameStatus,
  gameDatesOf,
  isGameStatus,
  isValidUnitPrice,
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
  type FieldErrorTexts,
  withoutFieldError,
} from "@/lib/base/field-errors";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import type { TagPaletteKey } from "@/lib/project/tag-palettes";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { masterDataErrorOf } from "../master-data-error";
import {
  masterDataErrorTextsOf,
  masterDataFormatErrorsOf,
} from "../master-data-field-errors";

/** 表單欄位(= api `VALIDATION_FAILED` 的 `fields`)。 */
export type GameFormField =
  | "gameCode"
  | "name"
  | "status"
  | "unitPrice"
  | "ticketsPerBook"
  | "defaultRate"
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
  /** `YYYY-MM-DD`(租戶時區);null = 沒填(必填) */
  claimDeadline: string | null;
  color: TagPaletteKey | null;
  note: string;
}

const FIELDS: readonly GameFormField[] = [
  "gameCode",
  "name",
  "status",
  "unitPrice",
  "ticketsPerBook",
  "defaultRate",
  "claimDeadline",
  "color",
  "note",
];

/** 上市日、停售日(唯讀,`YYYY-MM-DD`;null = 還沒有兌獎截止日)。 */
export interface GameDerivedDateTexts {
  launchedAt: string | null;
  discontinuedAt: string | null;
}
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
        claimDeadline: localDayTextOf(game.claimDeadline, timezone),
        color: isTagPaletteKey(game.color) ? game.color : null,
        note: game.note ?? "",
      };

/** 兌獎截止日(`YYYY-MM-DD`)→ 推算的上市日 / 停售日(與 api 同一份 `gameDatesOf`)。 */
const derivedDateTextsOf = (
  claimDeadline: string | null,
): GameDerivedDateTexts => {
  const deadline = parseLocalDate(claimDeadline);
  if (deadline === null) {
    return { launchedAt: null, discontinuedAt: null };
  }
  const { launchedAt, discontinuedAt } = gameDatesOf(deadline);
  return {
    launchedAt: localDateText(launchedAt),
    discontinuedAt: localDateText(discontinuedAt),
  };
};

/** 送出前的檢查:必填、整數、單張金額 100 的倍數(範圍、格式、唯一由 api 判,錯誤標回欄位)。 */
const invalidFieldsOf = (values: GameFormValues): GameFormField[] => {
  const invalid: GameFormField[] = [];
  if (values.gameCode.trim() === "") invalid.push("gameCode");
  if (values.name.trim() === "") invalid.push("name");
  for (const field of INTEGER_FIELDS) {
    if (integerOf(values[field]) === null) invalid.push(field);
  }
  const unitPrice = integerOf(values.unitPrice);
  if (unitPrice !== null && !isValidUnitPrice(unitPrice)) {
    invalid.push("unitPrice");
  }
  if (parseLocalDate(values.claimDeadline) === null) {
    invalid.push("claimDeadline");
  }
  return invalid;
};

/**
 * 遊戲新增 / 編輯頁的表單狀態與送出(初始值只取一次,REACT-08)。
 * 選預設面額自動帶入張數(`@repo/domain` 的對照表);編輯只送改過的欄位(GQL-06,清空送 null)。
 * 上市日 / 停售日不送(api 由兌獎截止日推算並存):選了兌獎截止日就即時預覽;編輯頁沒改兌獎截止日時
 * 顯示 api 回傳的值。
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
  const [savedDates] = useState<GameDerivedDateTexts>(() => ({
    launchedAt: localDayTextOf(game?.launchedAt, timezone),
    discontinuedAt: localDayTextOf(game?.discontinuedAt, timezone),
  }));
  const derivedDates =
    game !== null && values.claimDeadline === initial.claimDeadline
      ? savedDates
      : derivedDateTextsOf(values.claimDeadline);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);頁面提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrorTexts<GameFormField>
  >({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const errorTextsOf = (error: unknown) =>
    masterDataErrorTextsOf("game", masterDataErrorOf(error), FIELDS, t);

  const onError = (error: unknown) => {
    const { texts, summary } = errorTextsOf(error);
    setFieldErrors(texts);
    setErrorText(summary);
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
  const feedbackError = (error: unknown) => errorTextsOf(error).summary;
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
    setFieldErrors((current) => withoutFieldError(current, key));
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
      claimDeadline: localDayInstantOf(values.claimDeadline, timezone),
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
    setFieldErrors(masterDataFormatErrorsOf("game", invalid, t));
    setErrorText(null);
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
    derivedDates,
    change,
    fieldErrors,
    errorText,
    isDirty,
    isSubmitting: create.isPending || update.isPending,
    submit,
  };
};
