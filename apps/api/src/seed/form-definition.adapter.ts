import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { normalizeSerialFormat } from "@repo/domain/form";
import type {
  DefinitionSeedOperation,
  FormDefinitionSeedSet,
} from "@repo/domain/seed";

import {
  FormVersionsRepository,
  PermissionsRepository,
} from "../database/database.module";
import {
  allowsDraft,
  sharedByFieldKeysOf,
  voidReasonCategoryOf,
} from "../database/schemas/form.schema";
import type { SeedInstallationMetadata } from "../database/schemas/seed-definition-installation.schema";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
} from "../forms/form-access.service";
import { FormDefinitionChecker } from "../forms/form-design/form-definition-checker";
import { FormPublishService } from "../forms/form-design/form-publish.service";
import { FormVersionsService } from "../forms/form-design/form-versions.service";
import { FormsService } from "../forms/form-design/forms.service";
import type { FormVersionRecord } from "../forms/form-mapper";
import {
  FORMS_PERMISSIONS,
  fieldPermissionKey,
} from "../forms/form-permission-keys";
import type {
  DefinitionAdapter,
  DefinitionSnapshot,
  IdentityExpectation,
  IdentityMetadata,
  VersionSnapshot,
} from "./definition-adapter";
import { formContentHash } from "./seed-content";

/** 表單退役沿用 `edit`(同 `retireCurrentVersion` 端點的守門)。 */
const APPLY_PERMISSIONS = [
  FORMS_PERMISSIONS.view,
  FORMS_PERMISSIONS.create,
  FORMS_PERMISSIONS.edit,
] as const;

const INSPECT_PERMISSIONS = [FORMS_PERMISSIONS.view] as const;

/** 受管表單的適配:讀經 repository,寫入全部轉呼叫表單設計服務(`forms/form-design/`)。 */
@Injectable()
export class FormDefinitionAdapter implements DefinitionAdapter<FormDefinitionSeedSet> {
  readonly kind = "form-definition";

  constructor(
    private readonly versions: FormVersionsRepository,
    private readonly permissions: PermissionsRepository,
    private readonly access: FormAccessService,
    private readonly forms: FormsService,
    private readonly versionsService: FormVersionsService,
    private readonly publisher: FormPublishService,
    private readonly checker: FormDefinitionChecker,
  ) {}

  permissionsFor(operation: DefinitionSeedOperation): readonly string[] {
    return operation === "apply" ? APPLY_PERMISSIONS : INSPECT_PERMISSIONS;
  }

  identityMetadataOf(seed: FormDefinitionSeedSet): IdentityMetadata {
    return {
      name: seed.name,
      tabLabelTemplate: seed.tabLabelTemplate,
      allowDraft: seed.allowDraft ?? true,
      ...serialMetadataOf(seed.serial),
      ...voidReasonMetadataOf(seed.voidReasonCategoryKey),
      ...sharedByMetadataOf(seed.sharedByFieldKeys),
    };
  }

  initialMetadataOf(seed: FormDefinitionSeedSet): IdentityMetadata {
    return { name: seed.name, tabLabelTemplate: null, allowDraft: true };
  }

  installationMetadataOf(
    seed: FormDefinitionSeedSet,
  ): SeedInstallationMetadata {
    return {
      name: seed.name,
      moduleKey: seed.moduleKey,
      tabLabelTemplate: seed.tabLabelTemplate,
      allowDraft: seed.allowDraft ?? true,
      ...(seed.serial === undefined ? {} : { serial: seed.serial }),
      ...(seed.voidReasonCategoryKey === undefined
        ? {}
        : { voidReasonCategoryKey: seed.voidReasonCategoryKey }),
      ...(seed.sharedByFieldKeys === undefined
        ? {}
        : { sharedByFieldKeys: [...seed.sharedByFieldKeys] }),
    };
  }

  async findDefinition(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<DefinitionSnapshot | null> {
    const form = await this.access.findForm(facts.operator, key);
    return form === null
      ? null
      : {
          id: form._id,
          isShared: form.ownerOrgId === null,
          moduleKey: form.moduleKey,
          currentVersion: form.currentVersion,
          metadata: {
            name: form.name,
            tabLabelTemplate: form.tabLabelTemplate,
            allowDraft: allowsDraft(form),
            ...serialMetadataOf(form.serial),
            ...voidReasonMetadataOf(voidReasonCategoryOf(form)),
            ...sharedByMetadataOf(sharedByFieldKeysOf(form)),
          },
        };
  }

  async findVersionById(
    facts: FormOperatorFacts,
    key: string,
    id: Types.ObjectId,
  ): Promise<VersionSnapshot | null> {
    return this.findVersion(facts, key, { _id: id });
  }

  async findVersionByNumber(
    facts: FormOperatorFacts,
    key: string,
    version: number,
  ): Promise<VersionSnapshot | null> {
    return this.findVersion(facts, key, { version });
  }

  async findDraft(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<VersionSnapshot | null> {
    return this.findVersion(facts, key, { status: "draft" });
  }

  async findLatestVersion(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<VersionSnapshot | null> {
    const form = await this.access.findForm(facts.operator, key);
    const [latest] = await this.versions.findMany(
      facts.operator,
      { formKey: key, version: { $ne: null } },
      { sort: { version: -1 }, limit: 1 },
    );
    return form !== null && latest !== undefined
      ? toSnapshot(form, latest)
      : null;
  }

  async validate(
    facts: FormOperatorFacts,
    seed: FormDefinitionSeedSet,
  ): Promise<string[]> {
    try {
      await this.access.requireFormModule(facts.operator, seed.moduleKey);
    } catch {
      return [`moduleKey:模組 ${seed.moduleKey} 不存在或不是表單模組`];
    }
    const report = await this.checker.check(
      facts,
      { key: seed.key, moduleKey: seed.moduleKey },
      seed.definition,
    );
    return report.errors.map((issue) => `${issue.code}:${issue.message}`);
  }

  async createIdentity(
    facts: FormOperatorFacts,
    seed: FormDefinitionSeedSet,
    definitionId: Types.ObjectId,
  ): Promise<void> {
    await this.forms.create(
      facts,
      { key: seed.key, moduleKey: seed.moduleKey, name: seed.name },
      { definitionId },
    );
  }

  async updateMetadata(
    facts: FormOperatorFacts,
    seed: FormDefinitionSeedSet,
    expected: IdentityExpectation,
  ): Promise<void> {
    await this.forms.update(
      facts,
      {
        key: seed.key,
        name: seed.name,
        tabLabelTemplate: seed.tabLabelTemplate,
        // 允許存草稿只在和現場不同時才帶:稽核不多記沒變的欄位,也不替舊表單寫進顯式的 true
        ...((seed.allowDraft ?? true) === (expected.metadata.allowDraft ?? true)
          ? {}
          : { allowDraft: seed.allowDraft ?? true }),
        // 單號格式同理:只在和現場不同時才帶
        ...(JSON.stringify(normalizeSerialFormat(seed.serial ?? null)) ===
        JSON.stringify(normalizeSerialFormat(expected.metadata.serial ?? null))
          ? {}
          : { serial: seed.serial ?? null }),
        // 作廢原因類別同理
        ...((seed.voidReasonCategoryKey ?? null) ===
        (expected.metadata.voidReasonCategoryKey ?? null)
          ? {}
          : { voidReasonCategoryKey: seed.voidReasonCategoryKey ?? null }),
        // 依欄位共用同理
        ...(sameSharedByFields(
          seed.sharedByFieldKeys,
          expected.metadata.sharedByFieldKeys,
        )
          ? {}
          : { sharedByFieldKeys: [...(seed.sharedByFieldKeys ?? [])] }),
      },
      {
        expected: {
          definitionId: expected.definitionId,
          currentVersion: expected.currentVersion,
          name: expected.metadata.name,
          tabLabelTemplate: expected.metadata.tabLabelTemplate ?? null,
          allowDraft: expected.metadata.allowDraft ?? true,
          serial: expected.metadata.serial ?? null,
          voidReasonCategoryKey:
            expected.metadata.voidReasonCategoryKey ?? null,
          sharedByFieldKeys: expected.metadata.sharedByFieldKeys ?? [],
        },
      },
    );
  }

  async createDraft(
    facts: FormOperatorFacts,
    key: string,
    draftId: Types.ObjectId,
  ): Promise<void> {
    await this.versionsService.createDraft(
      facts,
      { formKey: key, baseVersion: null },
      { draftId },
    );
  }

  async saveDraft(
    facts: FormOperatorFacts,
    seed: FormDefinitionSeedSet,
    draftId: Types.ObjectId,
    expectedDraftRevision: number,
  ): Promise<void> {
    const { fields, layout, summaryMap, prefills } = seed.definition;
    await this.versionsService.saveDraft(
      facts,
      {
        formKey: seed.key,
        expectedDraftRevision,
        fields: fields as unknown as Record<string, unknown>[],
        layout: layout as unknown as Record<string, unknown>,
        summaryMap: { ...summaryMap },
        prefills: prefills as unknown as Record<string, unknown>[],
      },
      { draftId },
    );
  }

  async publish(
    facts: FormOperatorFacts,
    seed: FormDefinitionSeedSet,
    draftId: Types.ObjectId,
    expectedDraftRevision: number,
    expected: { definitionId: Types.ObjectId; currentVersion: number | null },
  ): Promise<void> {
    await this.publisher.publish(
      facts,
      {
        formKey: seed.key,
        expectedDraftRevision,
        changelog: seed.changelog,
      },
      {
        draftId,
        expected: {
          ownerId: expected.definitionId,
          currentVersion: expected.currentVersion,
        },
      },
    );
  }

  async retire(
    facts: FormOperatorFacts,
    key: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.versionsService.retireCurrent(facts, {
      formKey: key,
      expectedVersion,
    });
  }

  async missingPermissions(
    facts: FormOperatorFacts,
    seed: FormDefinitionSeedSet,
  ): Promise<string[]> {
    const declared = seed.definition.fields.flatMap((field) =>
      (["show", "edit"] as const)
        .filter((action) => field.permission?.[action] === true)
        .map((action) =>
          fieldPermissionKey(seed.moduleKey, action, seed.key, field.key),
        ),
    );
    if (declared.length === 0) {
      return [];
    }
    const live = await this.permissions.findMany(facts.operator, {
      key: { $in: declared },
      source: "dynamic",
      retiredAt: null,
    });
    const liveKeys = new Set(live.map((permission) => permission.key));
    return declared.filter((key) => !liveKeys.has(key));
  }

  private async findVersion(
    facts: FormOperatorFacts,
    key: string,
    filter: { _id: Types.ObjectId } | { version: number } | { status: "draft" },
  ): Promise<VersionSnapshot | null> {
    const form = await this.access.findForm(facts.operator, key);
    if (form === null) {
      return null;
    }
    const record = await this.versions.findOne(facts.operator, {
      formKey: key,
      ...filter,
    });
    return record === null ? null : toSnapshot(form, record);
  }
}

function toSnapshot(
  form: FormRecord,
  record: FormVersionRecord,
): VersionSnapshot {
  return {
    id: record._id,
    version: record.version,
    status: record.status,
    draftRevision: record.draftRevision,
    contentHashWith: (metadata) =>
      formContentHash(
        {
          key: form.key,
          moduleKey: form.moduleKey,
          name: metadata.name,
          tabLabelTemplate: metadata.tabLabelTemplate ?? null,
          allowDraft: metadata.allowDraft ?? true,
          serial: metadata.serial ?? null,
          voidReasonCategoryKey: metadata.voidReasonCategoryKey ?? null,
          sharedByFieldKeys: metadata.sharedByFieldKeys ?? [],
        },
        {
          fields: record.fields,
          layout: record.layout,
          summaryMap: record.summaryMap,
          prefills: record.prefills,
        },
      ),
  };
}

/** 身分快照的作廢原因類別:沒設不帶這個鍵(這個欄位之前的快照與現在的比對結果相同)。 */
function voidReasonMetadataOf(
  key: string | null | undefined,
): Pick<IdentityMetadata, "voidReasonCategoryKey"> {
  return key === null || key === undefined
    ? {}
    : { voidReasonCategoryKey: key };
}

/** 身分快照的依欄位共用:沒設(空)不帶這個鍵(這個欄位之前的快照與現在的比對結果相同)。 */
function sharedByMetadataOf(
  keys: readonly string[] | undefined,
): Pick<IdentityMetadata, "sharedByFieldKeys"> {
  return keys === undefined || keys.length === 0
    ? {}
    : { sharedByFieldKeys: [...keys] };
}

/** 兩份依欄位共用是否相同(缺席 = 空;順序算)。 */
function sameSharedByFields(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/** 身分快照的單號格式:沒設不帶這個鍵(這個欄位之前的快照與現在的比對結果相同)。 */
function serialMetadataOf(stored: unknown): Pick<IdentityMetadata, "serial"> {
  const format = normalizeSerialFormat(stored ?? null);
  return format === null ? {} : { serial: format };
}
