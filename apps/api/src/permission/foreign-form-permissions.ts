import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { FormsRepository, OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { tenantIdOfOrg } from "../database/tenant-id";
import { parseFormPermissionKey } from "../forms/form-permission-keys";

/** 判斷要用的權限欄位(權限文件的子集;`source` 缺 = 不是動態權限)。 */
export interface PermissionKeySource {
  key: string;
  source?: string;
}

/**
 * **別租戶客製表單的動態權限**(`source: dynamic`,表單動態權限 key 拆得出 formKey,
 * 且那張表單的 `ownerOrgId` 不是 null、也不是操作者當前組織的租戶):對這位操作者視同不存在。
 *
 * `<模組>.*` 會展開成該模組全部權限(含別租戶客製表單的 `show-` / `edit-` / `create-`),
 * 若不過濾,`me.modules` 會把別租戶的 formKey、欄位 key 送到瀏覽器,權限矩陣也看得到、勾得到。
 * `PermissionResolver.resolve` 與權限矩陣都呼叫這一份(`me.modules`、`@RequirePermission`、矩陣三處一致)。
 *
 * - 根組織操作者(租戶 = null)只認共用表單(`ownerOrgId = null`)的動態權限
 * - 拆不出 formKey、或表單已不存在的動態權限一併視為別人的(fail-closed)
 * - 清單裡沒有動態權限就不查 forms / orgs(一般只持固定權限的操作者零額外查詢)
 */
@Injectable()
export class ForeignFormPermissions {
  constructor(
    private readonly forms: FormsRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** `permissions` 中屬於別租戶(或不存在)表單的動態權限 key。`reader` 須是全域讀取者(兩個範圍皆 `all`)。 */
  async keysOf(
    reader: OperatorContext,
    permissions: readonly PermissionKeySource[],
  ): Promise<Set<string>> {
    const parsed = permissions
      .filter((permission) => permission.source === "dynamic")
      .map((permission) => ({
        key: permission.key,
        form: parseFormPermissionKey(permission.key),
      }));
    if (parsed.length === 0) {
      return new Set();
    }
    const formKeys = [
      ...new Set(
        parsed.flatMap((entry) => (entry.form ? [entry.form.formKey] : [])),
      ),
    ];
    const [forms, tenantId] = await Promise.all([
      formKeys.length === 0
        ? []
        : this.forms.findMany(reader, { key: { $in: formKeys } }),
      this.tenantIdOf(reader),
    ]);
    const allowed = new Set(
      forms
        .filter(
          (form) =>
            form.ownerOrgId === null ||
            (tenantId !== null && form.ownerOrgId.equals(tenantId)),
        )
        .map((form) => form.key),
    );
    return new Set(
      parsed
        .filter((entry) => !entry.form || !allowed.has(entry.form.formKey))
        .map((entry) => entry.key),
    );
  }

  /** 操作者當前組織的租戶頂層;根組織(或沒有當前組織)= null。 */
  private async tenantIdOf(
    reader: OperatorContext,
  ): Promise<Types.ObjectId | null> {
    if (!reader.currentOrgId) {
      return null;
    }
    const org = await this.orgs.findById(reader, reader.currentOrgId);
    return org
      ? tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors })
      : null;
  }
}
