import { HttpResponse } from "msw";

import {
  type LotterySettingRow,
  LOTTERY_SETTINGS_PERMISSIONS as P,
  countModeSettingOf,
  resolveLotterySettings,
} from "@repo/domain/project/lottery-settings";
import type {
  CancelLotteryCountModeConversionMutationVariables,
  CustomizeLotterySettingMutationVariables,
  LotteryCountModeChangeCheckQuery,
  LotteryCountModeChangeCheckQueryVariables,
  LotterySettingsFieldsFragment,
  LotterySettingsQueryVariables,
  LotteryStoreCountModeHistoryQuery,
  RestoreLotterySettingMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api } from "../../server";
import {
  ALL_LOTTERY_SETTINGS_PERMISSIONS,
  LOTTERY_SETTINGS_STORES,
  lotterySettingsOrgs,
} from "./lottery-settings-fixtures";

type Check = LotteryCountModeChangeCheckQuery["lotteryCountModeChangeCheck"];
type HistoryItem =
  LotteryStoreCountModeHistoryQuery["lotteryStoreCountModeHistory"]["items"][number];

export interface LotterySettingsWorldOptions {
  /** 權限:`edit-default` 決定最上層組織能不能改、`edit-org` 決定分店 */
  permissions?: readonly string[];
  /** 當前組織(設定頁預設看的);預設中山店 */
  currentOrgId?: string;
  /** 已自訂的設定:組織 id → key → 選項 */
  ownRows?: Record<string, Record<string, string>>;
  /** 分店實際的盤點制度;沒給 = 編號 */
  storeModes?: Record<string, string>;
  /** 還有未對號張的分店(改編號時進轉換中) */
  unmatchedStores?: readonly string[];
  /** 檯面上還有待標註的本(分店 id → 本) */
  pendingSkipBooks?: Record<string, Check["pendingSkipBooks"]>;
  /** 有進行中的盤點 / 重刷 / 補點的分店 */
  busyStores?: readonly string[];
  /** 盤點制度變更紀錄(分店 id → 新到舊) */
  history?: Record<string, HistoryItem[]>;
}

const ORG_NAMES = new Map(
  Object.values(lotterySettingsOrgs).map((org) => [org.id, org.name]),
);
const nameOf = (orgId: string): string => ORG_NAMES.get(orgId) ?? orgId;
const isTenantTop = (orgId: string) => orgId === lotterySettingsOrgs.tenant.id;
const chainOf = (orgId: string): string[] =>
  isTenantTop(orgId) ? [orgId] : [orgId, lotterySettingsOrgs.tenant.id];

/**
 * 刮刮樂設定的假 api(有狀態:寫入後重查看得到新值)。生效值用 domain 的 `resolveLotterySettings`
 * (與 api 同一份);改盤點制度的檢查照 `docs/modules/project/lottery-settings.md` 的規則模擬
 * (只模擬「最上層組織 → 三家分店」兩層)。
 */
export const lotterySettingsWorld = (
  options: LotterySettingsWorldOptions = {},
) => {
  const permissions = options.permissions ?? ALL_LOTTERY_SETTINGS_PERMISSIONS;
  const currentOrgId = options.currentOrgId ?? lotterySettingsOrgs.zhongshan.id;
  const ownRows: Record<string, Record<string, string>> = {
    ...options.ownRows,
  };
  const storeModes: Record<string, string> = { ...options.storeModes };
  const unmatched = new Set(options.unmatchedStores);
  const busy = new Set(options.busyStores);
  const inputs = {
    customize: [] as CustomizeLotterySettingMutationVariables["input"][],
    restore: [] as RestoreLotterySettingMutationVariables["input"][],
    cancel: [] as CancelLotteryCountModeConversionMutationVariables["input"][],
    check: [] as LotteryCountModeChangeCheckQueryVariables["input"][],
  };

  const rowsOf = (rows: Record<string, Record<string, string>>) =>
    Object.entries(rows).flatMap(([orgId, keys]) =>
      Object.entries(keys).map(([key, option]): LotterySettingRow => ({
        orgId,
        key,
        value: { option },
      })),
    );
  const canEditOf = (orgId: string) =>
    permissions.includes(isTenantTop(orgId) ? P.editDefault : P.editOrg);
  const modeOf = (orgId: string) => storeModes[orgId] ?? "numbered";

  const payloadOf = (orgId: string): LotterySettingsFieldsFragment => {
    const chain = chainOf(orgId);
    const isStore = !isTenantTop(orgId);
    const canEdit = canEditOf(orgId);
    const valueOf = (setting: {
      option: string;
      source: string;
      sourceOrgId: string | null;
    }) => ({
      __typename: "LotterySettingValue" as const,
      option: setting.option,
      source: setting.source,
      sourceOrgName:
        setting.sourceOrgId === null ? null : nameOf(setting.sourceOrgId),
    });
    return {
      __typename: "LotterySettingsPayload",
      orgId,
      orgName: nameOf(orgId),
      isTenantTop: !isStore,
      isStore,
      canEdit,
      items: resolveLotterySettings(chain, rowsOf(ownRows)).map(
        ({ definition, effective, parent }) => ({
          __typename: "LotterySetting" as const,
          key: definition.key,
          options: [...definition.options],
          effective: valueOf(effective),
          parent: parent === null ? null : valueOf(parent),
        }),
      ),
      storeCountMode: isStore
        ? {
            __typename: "LotteryStoreCountMode",
            mode: modeOf(orgId),
            since: null,
            lastRenumberAt: null,
            canCancelConversion: canEdit && modeOf(orgId) === "converting",
          }
        : null,
    };
  };

  /** 改盤點制度(`option` null = 還原)的檢查。 */
  const checkOf = (orgId: string, option: string | null): Check => {
    const after: Record<string, Record<string, string>> = {
      ...ownRows,
      [orgId]: { ...ownRows[orgId] },
    };
    const own = after[orgId] ?? {};
    if (option === null) {
      delete own.count_mode;
    } else {
      own.count_mode = option;
    }
    const stores = LOTTERY_SETTINGS_STORES.filter(
      (store) => store.id === orgId || isTenantTop(orgId),
    ).flatMap((store) => {
      const before = countModeSettingOf(chainOf(store.id), rowsOf(ownRows));
      const next = countModeSettingOf(chainOf(store.id), rowsOf(after));
      if (before === next) {
        return [];
      }
      const from = modeOf(store.id);
      let to = "count";
      if (next === "numbered") {
        to =
          from !== "numbered" && unmatched.has(store.id)
            ? "converting"
            : "numbered";
      }
      const pending =
        next === "count" && from === "numbered"
          ? (options.pendingSkipBooks?.[store.id] ?? [])
          : [];
      const problems = [
        ...(pending.length > 0 ? ["pending_skip"] : []),
        ...(busy.has(store.id) ? ["busy"] : []),
      ];
      return [{ store, from, to, pending, problems }];
    });
    return {
      __typename: "LotteryCountModeChangeCheck",
      stores: stores.map(({ store, from, to, problems }) => ({
        __typename: "LotteryCountModeChangeStore" as const,
        orgId: store.id,
        orgName: store.name,
        from,
        to,
        problems,
      })),
      pendingSkipBooks: stores.flatMap(({ pending }) => pending),
      busyStores: stores
        .filter(({ store }) => busy.has(store.id))
        .map(({ store }) => ({
          __typename: "LotteryCountModeBusyStore" as const,
          orgId: store.id,
          orgName: store.name,
          stocktake: true,
          rescan: false,
          renumber: false,
        })),
      canSave: stores.every(({ problems }) => problems.length === 0),
    };
  };

  /** 寫入一層的盤點制度;有分店被擋就回錯誤(不寫)。 */
  const writeCountMode = (
    orgId: string,
    option: string | null,
  ): Response | null => {
    const check = checkOf(orgId, option);
    if (!check.canSave) {
      return graphqlError("VALIDATION_FAILED", "blocked", {
        reason: "COUNT_MODE_CHANGE_BLOCKED",
        fields: ["option"],
      });
    }
    for (const store of check.stores) {
      storeModes[store.orgId] = store.to;
    }
    return null;
  };

  const denied = (orgId: string) =>
    canEditOf(orgId)
      ? null
      : graphqlError("FORBIDDEN", "missing permission", {
          reason: "MISSING_PERMISSION",
        });

  const handlers = [
    api.query<
      { lotterySettings: LotterySettingsFieldsFragment },
      LotterySettingsQueryVariables
    >("LotterySettings", ({ variables }) =>
      HttpResponse.json({
        data: {
          lotterySettings: payloadOf(variables.input?.orgId ?? currentOrgId),
        },
      }),
    ),
    api.query<
      LotteryCountModeChangeCheckQuery,
      LotteryCountModeChangeCheckQueryVariables
    >("LotteryCountModeChangeCheck", ({ variables }) => {
      inputs.check.push(variables.input);
      return HttpResponse.json({
        data: {
          lotteryCountModeChangeCheck: checkOf(
            variables.input.orgId ?? currentOrgId,
            variables.input.option ?? null,
          ),
        },
      });
    }),
    api.query("LotteryStoreCountModeHistory", ({ variables }) => {
      const { orgId } = (variables as { input: { orgId: string } }).input;
      return HttpResponse.json({
        data: {
          lotteryStoreCountModeHistory: {
            __typename: "LotteryStoreCountModeHistory",
            orgId,
            orgName: nameOf(orgId),
            items: options.history?.[orgId] ?? [],
          },
        },
      });
    }),
    api.mutation<
      Record<string, unknown>,
      CustomizeLotterySettingMutationVariables
    >("CustomizeLotterySetting", ({ variables }) => {
      inputs.customize.push(variables.input);
      const orgId = variables.input.orgId ?? currentOrgId;
      const refused =
        denied(orgId) ??
        (variables.input.key === "count_mode"
          ? writeCountMode(orgId, variables.input.option)
          : null);
      if (refused !== null) {
        return refused;
      }
      ownRows[orgId] = {
        ...ownRows[orgId],
        [variables.input.key]: variables.input.option,
      };
      return HttpResponse.json({
        data: {
          customizeLotterySetting: {
            __typename: "LotterySettingMutationPayload",
            settings: payloadOf(orgId),
          },
        },
      });
    }),
    api.mutation<
      Record<string, unknown>,
      RestoreLotterySettingMutationVariables
    >("RestoreLotterySetting", ({ variables }) => {
      inputs.restore.push(variables.input);
      const orgId = variables.input.orgId ?? currentOrgId;
      const refused =
        denied(orgId) ??
        (variables.input.key === "count_mode"
          ? writeCountMode(orgId, null)
          : null);
      if (refused !== null) {
        return refused;
      }
      ownRows[orgId] = Object.fromEntries(
        Object.entries(ownRows[orgId] ?? {}).filter(
          ([key]) => key !== variables.input.key,
        ),
      );
      return HttpResponse.json({
        data: {
          restoreLotterySetting: {
            __typename: "LotterySettingMutationPayload",
            settings: payloadOf(orgId),
          },
        },
      });
    }),
    api.mutation<
      Record<string, unknown>,
      CancelLotteryCountModeConversionMutationVariables
    >("CancelLotteryCountModeConversion", ({ variables }) => {
      inputs.cancel.push(variables.input);
      const orgId = variables.input.orgId;
      const refused = denied(orgId);
      if (refused !== null) {
        return refused;
      }
      if (modeOf(orgId) !== "converting") {
        return graphqlError("VALIDATION_FAILED", "not converting", {
          reason: "NOT_CONVERTING",
        });
      }
      storeModes[orgId] = "count";
      ownRows[orgId] = { ...ownRows[orgId], count_mode: "count" };
      return HttpResponse.json({
        data: {
          cancelLotteryCountModeConversion: {
            __typename: "LotterySettingMutationPayload",
            settings: payloadOf(orgId),
          },
        },
      });
    }),
  ];

  return { handlers, inputs, storeModes };
};
