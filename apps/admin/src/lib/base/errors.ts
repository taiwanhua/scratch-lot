import { ClientError } from "@repo/graphql";

/**
 * admin 各頁錯誤解讀(`<ns>ErrorOf(error)`)**唯一的回傳形狀**(DATA-06)。
 *
 * 在此之前七支 `*-error.ts` 各回各的:有的回裸字串碼、有的回 `{ code, fields }`、
 * 有的回 `{ code, reasons, fields }`,呼叫端要先記住「這頁回的是哪一種」。現在一律是這個物件,
 * 顯示文案一律 `tErrors(xxxErrorOf(error).code)`(GQL-04 的錯誤碼表決定哪個碼顯示什麼)。
 *
 * 選填欄位**只在 api 真的帶了、且認得出來時才出現**(沒有就是缺席,不是空陣列 / `null`):
 * 呼叫端讀 `error.fields ?? []`、`error.reasons ?? []`。
 */
export interface AdminError<
  Code extends string = string,
  Reason extends string = string,
> {
  /** 業務錯誤碼;該頁沒宣告的碼一律 `UNEXPECTED`,文案在 `<ns>.errors.<code>` */
  code: Code;
  /** `extensions.reason`(單一原因,如資料範圍 `RULE_INVALID` 的原因列舉);只收該頁宣告過的值 */
  reason?: Reason;
  /** `extensions.reasons`(逐項原因清單,如 `ORG_NOT_DELETABLE` / `ROLE_NOT_DELETABLE`);只收該頁宣告過的值 */
  reasons?: Reason[];
  /** `extensions.fields`:`VALIDATION_FAILED` 時 api 指出的欄位名,前端據此標在對應的表單欄位上 */
  fields?: string[];
  /** `extensions.path`:資料範圍 `RULE_INVALID` 指到條件樹裡出問題的位置 */
  path?: string;
  /**
   * 專案錯誤碼:`FORBIDDEN` 帶了本頁不認得的 `reason`(大寫英數與底線)—— 專案登記的守門擋下
   * (`docs/concepts/workflow-engine.md`「掛接點」)。顯示走 `adminErrorText`:專案字典有
   * `admin.lifecycle.<reason>` 就用它,沒有退回 `<ns>.errors.FORBIDDEN`。
   */
  projectReason?: string;
  /**
   * 交易逾時(api `TRANSACTION_TIMEOUT`,GQL-04):處理太久、已整個回復。任何一頁的 `parseAdminError`
   * 都會標上,`code` 照舊是 `UNEXPECTED`(頁面自己的碼表不必登記);**只有經 `adminErrorText` /
   * `useAdminErrorText` 顯示的頁**據此顯示 `admin.app.errors.transactionTimeout`(已取消、資料沒有變更、
   * 請稍後再試),直接 `tErrors(code)` 的頁仍顯示該頁的 `UNEXPECTED` 文案。
   */
  timedOut?: true;
  /**
   * api 回的原始 `message`。**不拿來顯示**(文案一律走 `tErrors(code)`,I18N-01),
   * 只給除錯 / 記錄用。
   */
  message?: string;
}

/** 各頁 `*ErrorOf` 交給 `parseAdminError` 的宣告:這頁認得哪些碼、哪些原因。 */
export interface AdminErrorSpec<Code extends string, Reason extends string> {
  /** 這頁會分流的業務錯誤碼(GQL-04);不在表內的一律 `UNEXPECTED` */
  codes: readonly Code[];
  /** `reason` / `reasons` 的白名單;不給就兩者都不收 */
  reasons?: readonly Reason[];
  /**
   * 依 `extensions.reason` 把一個通用碼再細分成本頁自己的碼(`FORBIDDEN` + `NOT_OWNER` →
   * `NOT_OWNER`)。回 `undefined` 表示不細分、照 `codes` 判斷。
   */
  refine?: (code: string, reason: unknown) => Code | undefined;
}

interface GraphqlErrorItem {
  message?: unknown;
  extensions?: {
    code?: unknown;
    reason?: unknown;
    reasons?: unknown;
    fields?: unknown;
    path?: unknown;
  };
}

const graphqlErrorsOf = (error: unknown): GraphqlErrorItem[] => {
  if (!(error instanceof ClientError)) {
    return [];
  }
  const { errors } = error.response as { errors?: unknown };
  return Array.isArray(errors) ? (errors as GraphqlErrorItem[]) : [];
};

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

/** api 的交易逾時錯誤碼(`apps/api/src/database/transaction.ts` 的 `TRANSACTION_TIMEOUT_CODE`)。 */
export const TRANSACTION_TIMEOUT_CODE = "TRANSACTION_TIMEOUT";

/** 交易逾時的文案(根層 key;所有頁共用)。 */
export const TRANSACTION_TIMEOUT_TEXT_KEY =
  "admin.app.errors.transactionTimeout";

/** 專案錯誤碼的格式(同 api 掛接點守門的檢查)。 */
const PROJECT_REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** 專案錯誤碼的文案 namespace:專案在 `admin.json` 加 `lifecycle` namespace,key = 錯誤碼。 */
export const PROJECT_REASON_NAMESPACE = "admin.lifecycle";

export const projectReasonKey = (reason: string): string =>
  `${PROJECT_REASON_NAMESPACE}.${reason}`;

const isOneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && list.includes(value as T);

/** 交易逾時(任何一頁都認得,不必在頁面的碼表登記);不是 → null。 */
const timedOutErrorOf = (
  error: unknown,
): AdminError<"UNEXPECTED", never> | null => {
  const item = graphqlErrorsOf(error).find(
    (candidate) => candidate.extensions?.code === TRANSACTION_TIMEOUT_CODE,
  );
  if (item === undefined) {
    return null;
  }
  return {
    code: "UNEXPECTED",
    timedOut: true,
    ...(typeof item.message === "string" && { message: item.message }),
  };
};

/** 依這頁宣告的碼表解讀(`parseAdminError` 的主體;交易逾時另由 `timedOutErrorOf` 先判斷)。 */
const parseDeclaredError = <Code extends string, Reason extends string>(
  error: unknown,
  spec: AdminErrorSpec<Code, Reason>,
): AdminError<Code | "UNEXPECTED", Reason> => {
  for (const item of graphqlErrorsOf(error)) {
    const { code, reason, reasons, fields, path } = item.extensions ?? {};
    if (typeof code !== "string") {
      continue;
    }
    const matched =
      spec.refine?.(code, reason) ??
      (isOneOf(spec.codes, code) ? code : undefined);
    if (matched === undefined) {
      continue;
    }
    const known = spec.reasons ?? [];
    const knownReasons = stringsOf(reasons).filter((value): value is Reason =>
      isOneOf(known, value),
    );
    const fieldNames = stringsOf(fields);
    const isProjectReason =
      matched === "FORBIDDEN" &&
      typeof reason === "string" &&
      PROJECT_REASON_PATTERN.test(reason) &&
      !isOneOf(known, reason);
    return {
      code: matched,
      ...(isProjectReason && { projectReason: reason }),
      ...(isOneOf(known, reason) && { reason }),
      ...(knownReasons.length > 0 && { reasons: knownReasons }),
      ...(fieldNames.length > 0 && { fields: fieldNames }),
      ...(typeof path === "string" && { path }),
      ...(typeof item.message === "string" && { message: item.message }),
    };
  }
  return { code: "UNEXPECTED" };
};

/**
 * 把 graphql-request 的 `ClientError` 讀成 `AdminError`:交易逾時(`TRANSACTION_TIMEOUT`)每一頁都認得
 * (`code: UNEXPECTED` + `timedOut`);其餘取 `errors[]` 中**第一個認得的碼**,
 * 認不出來(或根本不是 `ClientError`,如網路錯誤)就是 `{ code: "UNEXPECTED" }`。
 * 各頁的 `<ns>ErrorOf` 只宣告自己的碼表,不再各自解析一次 `extensions`。
 */
export const parseAdminError = <Code extends string, Reason extends string>(
  error: unknown,
  spec: AdminErrorSpec<Code, Reason>,
): AdminError<Code | "UNEXPECTED", Reason> =>
  timedOutErrorOf(error) ?? parseDeclaredError(error, spec);

/** 根層翻譯函式要用到的兩個能力(use-intl 的 `useTranslations()` 回傳值即符合)。 */
export interface RootTranslator {
  (key: string): string;
  has: (key: string) => boolean;
}

/**
 * 錯誤的顯示文案:交易逾時(`timedOut`)一律是共用的那一句;專案錯誤碼(`projectReason`)在字典裡有
 * `admin.lifecycle.<碼>` 就用它,否則照舊 `tErrors(code)`(沒有專案文案的專案錯誤碼 → 通用的「沒有權限」)。
 */
export const adminErrorText = <Code extends string>(
  error: Pick<AdminError<Code>, "code" | "projectReason" | "timedOut">,
  tErrors: (code: Code) => string,
  t: RootTranslator,
): string => {
  if (error.timedOut === true && t.has(TRANSACTION_TIMEOUT_TEXT_KEY)) {
    return t(TRANSACTION_TIMEOUT_TEXT_KEY);
  }
  if (error.projectReason !== undefined) {
    const key = projectReasonKey(error.projectReason);
    if (t.has(key)) {
      return t(key);
    }
  }
  return tErrors(error.code);
};
