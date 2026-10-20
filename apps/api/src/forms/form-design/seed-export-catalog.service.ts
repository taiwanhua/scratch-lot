import { Inject, Injectable } from "@nestjs/common";

import type { FormDefinition } from "@repo/domain/form";
import type {
  PortableCatalog,
  PortableLookupProvider,
} from "@repo/domain/seed";

import {
  FieldCategoriesRepository,
  FieldsRepository,
  FormVersionsRepository,
  FormsRepository,
  ModulesRepository,
} from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { PROJECT_LOOKUP_SOURCES } from "../../database/project-lookup-sources";
import { fieldReadContext } from "../../fields/field-visibility";
import type { LookupProviderRegistration } from "../lookup-provider-registration";
import { toPlainJson } from "./seed-export";

/**
 * 匯出時的可攜性目錄(`@repo/domain/seed` 的 `PortableCatalog`):這個環境裡「有穩定 key、能跟著設定交付」的依賴。
 *
 * - 表單模組:`modules.engine = "form"` 的模組 key
 * - 受管欄位類別:seed 宣告的系統類別(`isSystem`)與它的全域種子選項;畫面上自建的類別與租戶自訂選項不算
 * - 共用表單:`ownerOrgId = null` 且有目前版本的表單,內容取**目前版本**(被匯出的那張表單自己由宣告本身解析)
 * - 租戶客製表單的 key:只用來把「引用了客製表單」講清楚,內容不讀
 * - 可攜的專案 lookup 來源:專案 lookup 登記(`project/lookup-providers.ts`)宣告了 `portable` 的那幾個
 *
 * 只讀取,不寫入。目錄代表的是來源環境的現況;登記進 repo 時另由種子組裝以 registry 再驗一次。
 */
@Injectable()
export class SeedExportCatalogService {
  constructor(
    private readonly forms: FormsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly modules: ModulesRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly fields: FieldsRepository,
    @Inject(PROJECT_LOOKUP_SOURCES)
    private readonly lookupSources: readonly LookupProviderRegistration[],
  ) {}

  async catalogOf(operator: OperatorContext): Promise<PortableCatalog> {
    const [formModuleKeys, fieldCategories, forms] = await Promise.all([
      this.formModuleKeys(operator),
      this.managedCategories(operator),
      this.forms.findMany(operator, {}),
    ]);
    const shared = forms.filter(
      (form) => form.ownerOrgId === null && form.currentVersion !== null,
    );
    return {
      formModuleKeys,
      fieldCategories,
      sharedForms: await this.currentDefinitions(operator, shared),
      tenantFormKeys: new Set(
        forms.filter((form) => form.ownerOrgId !== null).map(({ key }) => key),
      ),
      lookupProviders: this.portableLookupProviders(),
    };
  }

  /** 宣告了 `portable` 的專案 lookup 來源(與種子組裝的 `portableLookupProviders` 同一份)。 */
  private portableLookupProviders(): ReadonlyMap<
    string,
    PortableLookupProvider
  > {
    return new Map(
      this.lookupSources.flatMap(({ declaration }) =>
        declaration.portable === undefined
          ? []
          : [[declaration.key, declaration.portable] as const],
      ),
    );
  }

  private async formModuleKeys(
    operator: OperatorContext,
  ): Promise<ReadonlySet<string>> {
    const modules = await this.modules.findMany(operator, { engine: "form" });
    return new Set(modules.map((module) => module.key));
  }

  /** 系統類別 key → 全域種子選項的 value。 */
  private async managedCategories(
    operator: OperatorContext,
  ): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const categories = await this.categories.findMany(operator, {
      isSystem: true,
    });
    const managed = new Map(
      categories.map((category) => [category.key, new Set<string>()]),
    );
    const keyById = new Map(
      categories.map((category) => [String(category._id), category.key]),
    );
    // 查詢釘死在全域種子選項(orgId = null),不讀任何租戶的自訂選項
    const options = await this.fields.findMany(fieldReadContext(operator), {
      categoryId: { $in: categories.map((category) => category._id) },
      orgId: null,
      isSystem: true,
    });
    for (const option of options) {
      const key = keyById.get(String(option.categoryId));
      if (key !== undefined) {
        managed.get(key)?.add(option.value);
      }
    }
    return managed;
  }

  private async currentDefinitions(
    operator: OperatorContext,
    forms: readonly { key: string; currentVersion: number | null }[],
  ): Promise<ReadonlyMap<string, FormDefinition>> {
    if (forms.length === 0) {
      return new Map();
    }
    const versions = await this.versions.findMany(operator, {
      $or: forms.map((form) => ({
        formKey: form.key,
        version: form.currentVersion,
      })),
    });
    return new Map(
      versions.map((version) => [
        version.formKey,
        toPlainJson<FormDefinition>({
          fields: version.fields,
          layout: version.layout,
          summaryMap: version.summaryMap,
          prefills: version.prefills,
        }),
      ]),
    );
  }
}
