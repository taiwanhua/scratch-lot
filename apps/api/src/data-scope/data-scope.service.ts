import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Types } from "mongoose";

import { validateAudience as validateAudienceShape } from "@repo/domain/audience";
import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";

import { AudienceService } from "../audience/audience.service";
import { AuditService } from "../audit/audit.service";
import type { Persisted } from "../database/base.repository";
import {
  DataScopeRulesRepository,
  type DataScopeTargetDocument,
  DataScopeTargetsRepository,
  ModulesRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  type DataScopeRuleProvider,
  setDataScopeRuleProvider,
} from "../database/plugins/data-scope-provider";
import {
  tenantTimezoneOf,
  tenantTimezoneOfOrg,
} from "../database/tenant-timezone";
import { OwnerProtectionService } from "../orgs/owner-protection.service";
import {
  rootOnlyError,
  ruleInvalidError,
  targetNotFoundError,
} from "./data-scope-error";
import {
  DATA_SCOPE_AUDIENCE_OPTIONS,
  type DataScopeField,
  type DataScopeGroupOp,
  type DataScopeOperatorFacts,
  type DataScopeRuleEntry,
  type DataScopeTimezones,
  type ModuleCondition,
  combineByModule,
  compileRules,
  fieldCatalogOf,
  hasDateCondition,
  validateRules,
} from "./data-scope-rule";
import type { SaveDataScopeRuleInput } from "./dto/save-data-scope-rule.input";
import type {
  DataScopeCombineOpEnum,
  DataScopeFieldTypeEnum,
  DataScopeRuleModel,
  DataScopeTargetModel,
} from "./models/data-scope.model";

/** 審計動作名(`docs/modules/data-scope.md`「審計動作」)。 */
const AUDIT_ACTION = "data-scope.edit";
const AUDIT_TARGET_TYPE = "data_scope_rule";

/**
 * 讀 `data_scope_targets` / `data_scope_rules` 用的上下文:兩張表都沒掛 tenantScope
 * (種子表 + 根組織專屬設定),所以兩個範圍在此無作用;只用來讓 BaseRepository 收得到上下文。
 * 規則的讀取發生在**查詢中介層裡**,不能倚賴當下那個操作者的範圍 — 否則變成規則自己被規則過濾。
 */
const RULE_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

/** 快取中的一份規則(某個模組的):沒有規則的模組不進快取。 */
interface CachedRule {
  combineOp: DataScopeGroupOp;
  rules: DataScopeRuleEntry[];
  /** 編譯時要靠它決定值的型別(org/user → ObjectId、date → 時點範圍、enum → 字串)。 */
  catalog: DataScopeField[];
  /** 有日期條件:查詢時要先讀規則作者(根組織)與操作者所在租戶的時區(沒有就不讀)。 */
  hasDateCondition: boolean;
  /**
   * 有規則的套用對象不是人員條件格式(改格式前存的舊資料、壞資料):判斷不了套用到誰,
   * 這個目標對**所有人**命中不到任何資料(fail-closed;跳過那條會變成多看)。
   */
  hasInvalidAudience: boolean;
}

/** 命中不到任何文件的條件(fail-closed 用)。 */
const MATCH_NOTHING = { _id: { $in: [] } };

/** 一個 collection 的快取:moduleKey → 該模組的規則;空 Map = 這張表沒有任何模組設了規則。 */
type CollectionRules = Map<string, CachedRule>;

type TargetRecord = Persisted<DataScopeTargetDocument>;

/**
 * 資料範圍(`system.data-scope`,ADR-0008)。resolver 薄、service 厚(STRUCT-01)。
 *
 * 兩個職責:
 * 1. **設定面**:資料目標(一個模組一個)與欄位目錄、讀規則、整份覆蓋儲存(驗證 + 審計 + 作廢快取)
 * 2. **執行面**:實作 `DataScopeRuleProvider`,在 Nest 啟動時註冊給查詢中介層
 *    (`database/plugins/tenant-scope.plugin.ts`),讓每一次模組資料查詢都在租戶保底之內再套規則
 *
 * **依模組**:目標與規則以 `(collection, moduleKey)` 為鍵;查某 collection 時,把該 collection 下
 * 命中操作者的規則依模組拼成 `$or`(`combineByModule`)。
 *
 * **快取**:`Map<collection, Map<moduleKey, CachedRule>>`,儲存時作廢該 collection(ADR-0008
 * 「設定整包記憶體快取,儲存時作廢」)。**多執行個體的一致性不處理** —
 * 同一份規則改動後,其他執行個體要到自己的快取被作廢(重啟)才會跟上;
 * 規則是低頻設定、且各執行個體最終一致,現階段可接受,需要時再上 pub/sub 或短 TTL。
 */
@Injectable()
export class DataScopeService
  implements DataScopeRuleProvider, OnModuleInit, OnModuleDestroy
{
  private readonly cache = new Map<string, CollectionRules>();
  /**
   * 日期條件的兩個時區,同一個操作者上下文(= 同一個請求)只讀一次。**不跟著規則快取**:
   * 時區改了下一個請求就生效,不必等存規則或重啟,多執行個體之間也不會不一致。
   */
  private readonly timezonesCache = new WeakMap<
    OperatorContext,
    Promise<DataScopeTimezones>
  >();

  constructor(
    private readonly rules: DataScopeRulesRepository,
    private readonly targets: DataScopeTargetsRepository,
    private readonly modules: ModulesRepository,
    private readonly orgs: OrgsRepository,
    private readonly audit: AuditService,
    private readonly ownerProtection: OwnerProtectionService,
    private readonly audience: AudienceService,
  ) {}

  onModuleInit(): void {
    setDataScopeRuleProvider(this);
  }

  onModuleDestroy(): void {
    setDataScopeRuleProvider(undefined);
  }

  // ---- 執行面(查詢中介層) ----

  /**
   * 查詢中介層的唯一入口:回傳要 AND 進查詢的條件,沒有任何模組的規則命中 → `null`。
   * 套用對象的命中由 `AudienceService.matchesAudience` 判斷(人員條件;同一個請求的事實只算一次),
   * 動態值代入、combineOp 合成在 `compileRules`,依模組拼 `$or` 在 `combineByModule`
   * (都是 `data-scope-rule.ts` 的純函式)。
   */
  async conditionFor(
    collection: string,
    operator: OperatorContext,
  ): Promise<Record<string, unknown> | null> {
    const byModule = await this.rulesOf(collection);
    if (byModule.size === 0) {
      return null;
    }
    const facts = factsOf(operator);
    const needsTimezone = [...byModule.values()].some(
      (cached) => cached.hasDateCondition,
    );
    const timezones = needsTimezone
      ? await this.timezonesOf(operator)
      : { rule: DEFAULT_TENANT_TIMEZONE, operator: DEFAULT_TENANT_TIMEZONE };
    const conditions: ModuleCondition[] = [];
    for (const [moduleKey, cached] of byModule) {
      if (cached.hasInvalidAudience) {
        conditions.push({ moduleKey, condition: MATCH_NOTHING });
        continue;
      }
      const matched = await this.matchedRules(cached.rules, operator);
      if (matched.length === 0) {
        continue;
      }
      const condition = compileRules(
        matched,
        cached.combineOp,
        cached.catalog,
        facts,
        timezones,
      );
      if (condition) {
        conditions.push({ moduleKey, condition });
      }
    }
    return combineByModule(conditions);
  }

  /** 套用對象命中操作者的規則(依序判斷;順序不影響合成結果)。 */
  private async matchedRules(
    rules: readonly DataScopeRuleEntry[],
    operator: OperatorContext,
  ): Promise<DataScopeRuleEntry[]> {
    const matched: DataScopeRuleEntry[] = [];
    for (const rule of rules) {
      if (await this.audience.matchesAudience(operator, rule.audience)) {
        matched.push(rule);
      }
    }
    return matched;
  }

  /**
   * 日期條件的兩個租戶時區(`compileDateLeaf` 的「日曆天,逐租戶套用」):
   * - `rule`:規則作者的時區。規則是根組織專屬設定、沒有 `orgId`,作者就是根組織(`settings.timezone`)
   * - `operator`:操作者當前組織所屬租戶的時區;沒有當前組織(系統上下文)→ 根組織的
   *
   * 兩個都是沒設或不合法 → `DEFAULT_TENANT_TIMEZONE`(`tenantTimezoneOf`)。
   * 讀組織發生在查詢中介層裡:`orgs` 是治理類、不套資料範圍規則,不會遞迴回到這裡。
   */
  private timezonesOf(operator: OperatorContext): Promise<DataScopeTimezones> {
    const cached = this.timezonesCache.get(operator);
    if (cached) {
      return cached;
    }
    const ruleTimezone = tenantTimezoneOf(this.orgs, RULE_READER, null);
    const operatorTimezone = operator.currentOrgId
      ? tenantTimezoneOfOrg(this.orgs, RULE_READER, operator.currentOrgId)
      : ruleTimezone;
    const resolved = Promise.all([ruleTimezone, operatorTimezone]).then(
      ([rule, operatorZone]) => ({ rule, operator: operatorZone }),
    );
    this.timezonesCache.set(operator, resolved);
    return resolved;
  }

  private async rulesOf(collection: string): Promise<CollectionRules> {
    const hit = this.cache.get(collection);
    if (hit !== undefined) {
      return hit;
    }
    const loaded = await this.load(collection);
    this.cache.set(collection, loaded);
    return loaded;
  }

  private async load(collection: string): Promise<CollectionRules> {
    // 共用快取的載入一律在交易外讀(`session: null`):快取跨請求共用,不能讀到某個交易尚未提交的內容,
    // 也不能因為那個交易回復而留下錯的快取(TX-03)
    const [documents, targets] = await Promise.all([
      this.rules.findMany(RULE_READER, { collection }, { session: null }),
      this.targets.findMany(RULE_READER, { collection }, { session: null }),
    ]);
    const targetByModule = new Map(
      targets.map((target) => [target.moduleKey, target]),
    );
    const loaded: CollectionRules = new Map();
    for (const document of documents) {
      // 空 `rules` = 已被清掉的規則(ADR-0008),等同沒有規則。
      // 沒有 moduleKey 的舊文件(回填前)不知道該套在哪個模組:跳過,不拿 undefined 當 Map 的鍵
      if (
        document.rules.length === 0 ||
        typeof document.moduleKey !== "string"
      ) {
        continue;
      }
      const rules = document.rules as unknown as DataScopeRuleEntry[];
      // 套用對象不是人員條件格式(改格式前存的舊資料;環境清空重建、不寫遷移)→ 整個目標 fail-closed,
      // 舊形狀也不會走進判斷程式
      const hasInvalidAudience = rules.some(
        (rule) =>
          !validateAudienceShape(rule.audience, DATA_SCOPE_AUDIENCE_OPTIONS).ok,
      );
      const catalog = fieldCatalogOf(
        declaredFieldsOf(targetByModule.get(document.moduleKey) ?? null),
      );
      loaded.set(document.moduleKey, {
        combineOp: document.combineOp,
        rules,
        catalog,
        hasDateCondition:
          !hasInvalidAudience && hasDateCondition(rules, catalog),
        hasInvalidAudience,
      });
    }
    return loaded;
  }

  // ---- 設定面(「資料範圍」頁) ----

  /**
   * 資料目標清單(seed;**一列 = 一個模組**);每個目標的欄位目錄已附上底座的基礎欄位(ADR-0008)。
   * `hasRule` 一次取全部規則文件算出來,前端不必對每個目標各查一次規則。
   * 依模組 key 排序:同一棵模組樹的目標排在一起(前端可再依模組樹分組)。
   */
  async listTargets(
    operator: OperatorContext,
  ): Promise<DataScopeTargetModel[]> {
    await this.assertRootOperator(operator, "dataScopeTargets");
    const [documents, rules] = await Promise.all([
      this.targets.findMany(
        RULE_READER,
        {},
        { sort: { moduleKey: 1, collection: 1 } },
      ),
      this.rules.findMany(RULE_READER, {}),
    ]);
    // 空 `rules` = 已被清掉的規則(ADR-0008),不算已設 — 與執行面的 `load` 同一條判準
    const withRule = new Set(
      rules
        .filter((rule) => rule.rules.length > 0)
        .map((rule) => targetKeyOf(rule.collection, rule.moduleKey)),
    );
    const moduleNames = await this.moduleNamesOf(
      documents.map((target) => target.moduleKey),
    );
    return documents.map((target) =>
      toTargetModel(
        target,
        withRule.has(targetKeyOf(target.collection, target.moduleKey)),
        moduleNames.get(target.moduleKey) ?? target.name,
      ),
    );
  }

  /** 某目標目前的規則;尚未設定過 → `null`(ADR-0008:沒有規則 = 只有租戶保底)。 */
  async findRule(
    operator: OperatorContext,
    targetId: string,
  ): Promise<DataScopeRuleModel | null> {
    await this.assertRootOperator(operator, "dataScopeRule");
    const target = await this.mustFindTarget(targetId);
    const document = await this.rules.findOne(RULE_READER, {
      collection: target.collection,
      moduleKey: target.moduleKey,
    });
    if (!document) {
      return null;
    }
    return toRuleModel(target, document);
  }

  /**
   * 整份覆蓋(ADR-0008):先以該目標的欄位目錄驗「欄位存在 / 運算子符合型別 / 值來源符合型別」,
   * 任一不符 → `RULE_INVALID` 附 `path`;通過才寫入,並**立即作廢該 collection 的快取**。
   */
  async saveRule(
    operator: OperatorContext,
    input: SaveDataScopeRuleInput,
  ): Promise<DataScopeRuleModel> {
    await this.assertRootOperator(operator, AUDIT_ACTION);
    const target = await this.mustFindTarget(input.targetId);
    const catalog = fieldCatalogOf(declaredFieldsOf(target));
    const rules = input.rules.map((rule) => ({
      audience: rule.audience,
      filter: rule.filter,
    }));
    const violation = validateRules(rules, catalog);
    if (violation) {
      throw ruleInvalidError(violation);
    }

    const key = { collection: target.collection, moduleKey: target.moduleKey };
    const existing = await this.rules.findOne(RULE_READER, key);
    const before = existing
      ? { combineOp: existing.combineOp, rules: existing.rules }
      : undefined;
    const saved = existing
      ? await this.rules.updateById(RULE_READER, existing._id, {
          $set: { combineOp: input.combineOp, rules },
        })
      : await this.rules.create(RULE_READER, {
          ...key,
          combineOp: input.combineOp,
          rules,
        });
    if (!saved) {
      throw targetNotFoundError(input.targetId);
    }
    // 儲存即作廢(ADR-0008);下一次查詢重新載入該 collection 的全部模組規則
    this.cache.delete(target.collection);
    await this.audit.record(operator, {
      action: AUDIT_ACTION,
      targetType: AUDIT_TARGET_TYPE,
      targetId: saved._id,
      ...(before === undefined ? {} : { before }),
      after: {
        collection: target.collection,
        moduleKey: target.moduleKey,
        combineOp: input.combineOp,
        rules,
      },
    });
    return toRuleModel(target, saved);
  }

  private async mustFindTarget(targetId: string): Promise<TargetRecord> {
    if (!Types.ObjectId.isValid(targetId)) {
      throw targetNotFoundError(targetId);
    }
    const target = await this.targets.findById(RULE_READER, targetId);
    if (!target) {
      throw targetNotFoundError(targetId);
    }
    return target;
  }

  /** 模組 key → 模組顯示名(左清單的主文字);模組已不存在時由呼叫端退回目標自己的名稱。 */
  private async moduleNamesOf(keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) {
      return new Map();
    }
    const modules = await this.modules.findMany(RULE_READER, {
      key: { $in: [...new Set(keys)] },
    });
    return new Map(modules.map((module) => [module.key, module.name]));
  }

  /**
   * 「資料範圍」是根組織專屬模組(`isRootOnly`,ADR-0008 / docs/modules/data-scope.md):
   * 判準與租戶作業共用 `isRootOperator`(站在哪裡才算,權限可能經角色被帶到別的組織)。
   */
  private async assertRootOperator(
    operator: OperatorContext,
    action: string,
  ): Promise<void> {
    if (!(await this.ownerProtection.canActAsRoot(operator))) {
      throw rootOnlyError(action);
    }
  }
}

/** 目標的複合鍵(Set 查找用)。 */
function targetKeyOf(collection: string, moduleKey: string): string {
  return `${collection}\u0000${moduleKey}`;
}

/** OperatorContext → 規則比對 / 動態值代入需要的事實(ADR-0008)。 */
function factsOf(operator: OperatorContext): DataScopeOperatorFacts {
  return {
    actorId: operator.actorId,
    memberOrgIds: operator.memberOrgIds,
  };
}

/** `data_scope_targets.fields` 是 Mixed(seed 寫入);只取形狀對的欄位宣告。 */
function declaredFieldsOf(target: TargetRecord | null): DataScopeField[] {
  return (target?.fields ?? []) as unknown as DataScopeField[];
}

function toRuleModel(
  target: TargetRecord,
  document: {
    combineOp: string;
    rules: Record<string, unknown>[];
    updatedAt: Date;
  },
): DataScopeRuleModel {
  return {
    targetId: String(target._id),
    collection: target.collection,
    moduleKey: target.moduleKey,
    combineOp: document.combineOp as DataScopeCombineOpEnum,
    rules: document.rules as unknown as DataScopeRuleModel["rules"],
    updatedAt: document.updatedAt,
  };
}

function toTargetModel(
  target: TargetRecord,
  hasRule: boolean,
  moduleName: string,
): DataScopeTargetModel {
  return {
    id: String(target._id),
    collection: target.collection,
    moduleKey: target.moduleKey,
    moduleName,
    name: target.name,
    description: target.description ?? null,
    hasRule,
    fields: fieldCatalogOf(declaredFieldsOf(target)).map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type as DataScopeFieldTypeEnum,
      options: field.options ?? [],
      isBase: field.isBase === true,
    })),
  };
}
