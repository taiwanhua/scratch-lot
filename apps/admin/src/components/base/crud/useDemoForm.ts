import { useState } from "react";
import { useTranslations } from "use-intl";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";

import { type DemoError, demoErrorOf } from "./demo-error";
import type {
  DemoFormConfig,
  DemoItemLike,
  DemoUploadResults,
  DemoUploadedFile,
} from "./demo-module-config";
import { useDemoUpload } from "./useDemoUpload";

/**
 * 一個上傳欄的狀態。三種情形要分得開,因為送給 api 的值不一樣(GQL-06):
 * - 選了新檔(`file`)→ 上傳後送新檔案
 * - 按了移除(`isCleared`)→ 送 `null`(清空)
 * - 都沒動 → 不放進 input(缺席 = 不動;#427 起不再把原路徑原樣送回)
 */
export interface FileSlot {
  file: File | null;
  isCleared: boolean;
}

export const emptyFileSlot: FileSlot = { file: null, isCleared: false };

export interface UseDemoFormOptions<Detail extends DemoItemLike, Values> {
  /** 該模組的 i18n 命名空間(成功 / 失敗提示的文案都掛在它底下,#376) */
  i18nNamespace: string;
  form: DemoFormConfig<Detail, Values>;
  /** 編輯的那一筆;新增頁為 null。**外層已經 gate 過**(資料到了才掛,REACT-08) */
  item: Detail | null;
  /** 儲存成功後(頁面自己決定導去哪) */
  onSaved: () => void;
}

export interface DemoFormState<Values> {
  values: Values;
  setValue: <Key extends keyof Values>(key: Key, value: Values[Key]) => void;
  /** 某個上傳欄現在的狀態(以 `DemoUpload.key` 取) */
  slotOf: (key: string) => FileSlot;
  setSlot: (key: string, slot: FileSlot) => void;
  /** 有沒有未儲存的變更(離開前的放棄變更確認看它) */
  isDirty: boolean;
  isSubmitting: boolean;
  error: DemoError | null;
  submit: () => void;
}

/** 選項欄的值是物件、每次都重建,所以比 `value` 而不是比參照。 */
const comparableOf = (input: unknown): unknown =>
  typeof input === "object" && input !== null && "value" in input
    ? input.value
    : input;

/** 文字 / 選項欄的淺比較。 */
const isSameValue = (a: unknown, b: unknown): boolean =>
  a === b || comparableOf(a) === comparableOf(b);

/**
 * 新增 / 編輯共用的表單狀態(Figma 175:558)。
 *
 * 初始值由 `config.form.toValues` 帶進 `useState` 的初始化器(REACT-08:不在 effect 內 setState);
 * 要先取單筆的編輯情境由**外層 gate** —— 資料到了才掛這個表單,所以這裡的 `item` 必然已就緒。
 *
 * 送出分兩段:先把每個上傳欄解析成結果(選了新檔就上傳、按了移除為 null、沒動就不放),
 * 再把值與結果交給設定物件的 `useSave` 轉成該模組的 input。
 */
export const useDemoForm = <Detail extends DemoItemLike, Values>({
  i18nNamespace,
  form,
  item,
  onSaved,
}: UseDemoFormOptions<Detail, Values>): DemoFormState<Values> => {
  const t = useTranslations(i18nNamespace);
  const tErrors = useTranslations(`${i18nNamespace}.errors`);
  const { upload, isUploading } = useDemoUpload();

  const [initialValues] = useState(() => form.toValues(item));
  const [values, setValues] = useState(initialValues);
  const [slots, setSlots] = useState<Partial<Record<string, FileSlot>>>({});
  const [error, setError] = useState<DemoError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * 一次「儲存」= 上傳欄逐一上傳 + 設定物件的 create / update,所以回饋在這一層報一次
   * (#376):`useSave` 只收 `{ onSuccess(): void; onError(error): void }`,而且上傳
   * 失敗那條路徑根本不經過 mutation —— 掛在 mutation 的 options 上會漏掉它。
   */
  const feedback = useMutationFeedback({
    success:
      item === null ? t("feedback.createSuccess") : t("feedback.updateSuccess"),
    error: (failure: unknown) => tErrors(demoErrorOf(failure).code),
  });

  const save = form.useSave({
    item,
    onSuccess: () => {
      feedback.onSuccess();
      setIsSaving(false);
      onSaved();
    },
    onError: (error_: unknown) => {
      feedback.onError(error_);
      setIsSaving(false);
      setError(demoErrorOf(error_));
    },
  });

  const slotOf = (key: string): FileSlot => slots[key] ?? emptyFileSlot;

  const valueEntries = Object.entries(initialValues as Record<string, unknown>);
  const isDirty =
    valueEntries.some(
      ([key, initial]) =>
        !isSameValue((values as Record<string, unknown>)[key], initial),
    ) ||
    form.uploads.some((definition) => {
      const slot = slotOf(definition.key);
      return slot.file !== null || slot.isCleared;
    });

  /** 一個上傳欄 → 這次的結果;`undefined` = 沒動(不放進結果)。 */
  const resultOf = async (
    key: string,
  ): Promise<DemoUploadedFile | null | undefined> => {
    const definition = form.uploads.find((upload_) => upload_.key === key);
    if (definition === undefined) {
      return undefined;
    }
    const slot = slotOf(key);
    if (slot.file !== null) {
      return upload(slot.file, definition.purpose);
    }
    return slot.isCleared ? null : undefined;
  };

  const submit = () => {
    setError(null);
    setIsSaving(true);
    void (async () => {
      try {
        // 逐欄依序解析(封面 → 附件):兩欄同時換檔時,失敗的那一個要停在自己的錯誤上
        const uploads: Record<string, DemoUploadedFile | null> = {};
        for (const definition of form.uploads) {
          const result = await resultOf(definition.key);
          if (result !== undefined) {
            uploads[definition.key] = result;
          }
        }
        save.save(values, uploads satisfies DemoUploadResults);
      } catch (error_: unknown) {
        // 上傳自己失敗(沒走到 mutation):一樣算這次儲存失敗,照跳提示(#376)
        feedback.onError(error_);
        setIsSaving(false);
        setError(demoErrorOf(error_));
      }
    })();
  };

  return {
    values,
    setValue: (key, value) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    slotOf,
    setSlot: (key, slot) => {
      setSlots((current) => ({ ...current, [key]: slot }));
    },
    isDirty,
    isSubmitting: isSaving || isUploading,
    error,
    submit,
  };
};
