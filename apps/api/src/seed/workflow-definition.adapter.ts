import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type {
  DefinitionSeedOperation,
  WorkflowDefinitionSeedSet,
} from "@repo/domain/seed";

import { WorkflowVersionsRepository } from "../database/database.module";
import type { SeedInstallationMetadata } from "../database/schemas/seed-definition-installation.schema";
import {
  type WorkflowRecord,
  WorkflowsRepository,
} from "../database/workflows.repository";
import type { FormOperatorFacts } from "../forms/form-access.service";
import { definitionOfVersion } from "../workflows/workflow-definition-input";
import { WorkflowDefinitionChecker } from "../workflows/workflow-design/workflow-definition-checker";
import type { WorkflowVersionRecord } from "../workflows/workflow-design/workflow-mapper";
import { WorkflowPublishService } from "../workflows/workflow-design/workflow-publish.service";
import { WorkflowVersionsService } from "../workflows/workflow-design/workflow-versions.service";
import { WorkflowsService } from "../workflows/workflow-design/workflows.service";
import { WORKFLOWS_PERMISSIONS } from "../workflows/workflow-keys";
import type {
  DefinitionAdapter,
  DefinitionSnapshot,
  IdentityExpectation,
  IdentityMetadata,
  VersionSnapshot,
} from "./definition-adapter";
import { workflowContentHash } from "./seed-content";

/** 流程退役沿用 `publish`(同 `retireCurrentWorkflowVersion` 端點的守門)。 */
const APPLY_PERMISSIONS = [
  WORKFLOWS_PERMISSIONS.view,
  WORKFLOWS_PERMISSIONS.create,
  WORKFLOWS_PERMISSIONS.edit,
  WORKFLOWS_PERMISSIONS.publish,
] as const;

const INSPECT_PERMISSIONS = [WORKFLOWS_PERMISSIONS.view] as const;

/** 共用流程的邊界(`tenantId = null`):只有共用流程會被安裝。 */
const SHARED = null;

/** 受管流程的適配:讀經 repository,寫入全部轉呼叫流程設計服務(`workflows/workflow-design/`)。 */
@Injectable()
export class WorkflowDefinitionAdapter implements DefinitionAdapter<WorkflowDefinitionSeedSet> {
  readonly kind = "workflow-definition";

  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly service: WorkflowsService,
    private readonly versionsService: WorkflowVersionsService,
    private readonly publisher: WorkflowPublishService,
    private readonly checker: WorkflowDefinitionChecker,
  ) {}

  permissionsFor(operation: DefinitionSeedOperation): readonly string[] {
    return operation === "apply" ? APPLY_PERMISSIONS : INSPECT_PERMISSIONS;
  }

  identityMetadataOf(seed: WorkflowDefinitionSeedSet): IdentityMetadata {
    return { name: seed.name };
  }

  initialMetadataOf(seed: WorkflowDefinitionSeedSet): IdentityMetadata {
    return { name: seed.name };
  }

  installationMetadataOf(
    seed: WorkflowDefinitionSeedSet,
  ): SeedInstallationMetadata {
    return { name: seed.name, checkFormKey: seed.checkFormKey };
  }

  async findDefinition(
    _facts: FormOperatorFacts,
    key: string,
  ): Promise<DefinitionSnapshot | null> {
    const shared = await this.workflows.findOne(SHARED, { key });
    if (shared !== null) {
      return {
        id: shared._id,
        isShared: true,
        moduleKey: null,
        currentVersion: shared.currentVersion,
        metadata: { name: shared.name },
      };
    }
    // key 全域唯一:被某個租戶的客製流程占用時只知道身分與歸屬,內容不讀
    const owner = await this.workflows.findKeyOwner(key);
    return owner === null
      ? null
      : {
          id: owner._id,
          isShared: owner.tenantId === null,
          moduleKey: null,
          currentVersion: null,
          metadata: { name: "" },
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
    const workflow = await this.workflows.findOne(SHARED, { key });
    const [latest] = await this.versions.findMany(
      facts.operator,
      { workflowKey: key, version: { $ne: null } },
      { sort: { version: -1 }, limit: 1 },
    );
    return workflow !== null && latest !== undefined
      ? toSnapshot(workflow, latest)
      : null;
  }

  async validate(
    facts: FormOperatorFacts,
    seed: WorkflowDefinitionSeedSet,
  ): Promise<string[]> {
    const report = await this.checker.check(
      facts,
      { tenantId: SHARED },
      seed.definition,
      seed.checkFormKey,
    );
    return report.errors.map((issue) => `${issue.code}:${issue.message}`);
  }

  async createIdentity(
    facts: FormOperatorFacts,
    seed: WorkflowDefinitionSeedSet,
    definitionId: Types.ObjectId,
  ): Promise<void> {
    await this.service.create(
      facts,
      { key: seed.key, name: seed.name },
      { definitionId },
    );
  }

  async updateMetadata(
    facts: FormOperatorFacts,
    seed: WorkflowDefinitionSeedSet,
    expected: IdentityExpectation,
  ): Promise<void> {
    await this.service.update(
      facts,
      { key: seed.key, name: seed.name },
      {
        expected: {
          definitionId: expected.definitionId,
          currentVersion: expected.currentVersion,
          name: expected.metadata.name,
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
      { workflowKey: key, baseVersion: null },
      { draftId },
    );
  }

  async saveDraft(
    facts: FormOperatorFacts,
    seed: WorkflowDefinitionSeedSet,
    draftId: Types.ObjectId,
    expectedDraftRevision: number,
  ): Promise<void> {
    await this.versionsService.saveDraft(
      facts,
      {
        workflowKey: seed.key,
        expectedDraftRevision,
        definition: {
          steps: seed.definition.steps as unknown as Record<string, unknown>[],
          edges: seed.definition.edges ?? null,
          // 一定明給(含 null):缺席在原服務是「不動已存的值」,宣告的 null 是清空
          checkFormKey: seed.checkFormKey,
        },
      },
      { draftId },
    );
  }

  async publish(
    facts: FormOperatorFacts,
    seed: WorkflowDefinitionSeedSet,
    draftId: Types.ObjectId,
    expectedDraftRevision: number,
    expected: { definitionId: Types.ObjectId; currentVersion: number | null },
  ): Promise<void> {
    await this.publisher.publish(
      facts,
      {
        workflowKey: seed.key,
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
    await this.versionsService.retireCurrent(
      facts,
      { workflowKey: key },
      { expectedVersion },
    );
  }

  missingPermissions(): Promise<string[]> {
    return Promise.resolve([]);
  }

  private async findVersion(
    facts: FormOperatorFacts,
    key: string,
    filter: { _id: Types.ObjectId } | { version: number } | { status: "draft" },
  ): Promise<VersionSnapshot | null> {
    const workflow = await this.workflows.findOne(SHARED, { key });
    if (workflow === null) {
      return null;
    }
    const record = await this.versions.findOne(facts.operator, {
      workflowKey: key,
      ...filter,
    });
    return record === null ? null : toSnapshot(workflow, record);
  }
}

function toSnapshot(
  workflow: WorkflowRecord,
  record: WorkflowVersionRecord,
): VersionSnapshot {
  return {
    id: record._id,
    version: record.version,
    status: record.status,
    draftRevision: record.draftRevision,
    contentHashWith: (metadata) =>
      workflowContentHash(
        {
          key: workflow.key,
          name: metadata.name,
          checkFormKey: record.checkFormKey ?? null,
        },
        definitionOfVersion(record),
      ),
  };
}
