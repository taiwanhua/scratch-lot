import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";
import { Box } from "@repo/ui/box";
import { SelectField } from "@repo/ui/select-field";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import type {
  AudienceConditionDraft,
  AudienceValueDraft,
} from "@/lib/base/audience-draft";
import {
  type RoleMenuOption,
  roleOwnerOrgGroupNameOf,
  shouldGroupRolesByOwnerOrg,
} from "@/lib/base/role-options";

import { PermissionTreeSelect } from "./PermissionTreeSelect";
import type { AudiencePickerEnv } from "./audience-picker-env";
import type { AudienceUserOption } from "./useAudienceOptions";

/** 動態來源與「指定組織」在同一個下拉裡,用前綴區分。 */
const DYNAMIC_PREFIX = "dynamic:";
const STATIC_SOURCE = "static";

export interface AudienceValueFieldProps {
  condition: AudienceConditionDraft;
  env: AudiencePickerEnv;
  hasError: boolean;
  onChange: (value: AudienceValueDraft) => void;
}

const staticValues = (value: AudienceValueDraft): string[] =>
  value.kind === "static" ? value.values : [];

/**
 * 受控值是 id 陣列,Autocomplete 收的是選項物件 —— 在這裡對照回來。
 * 候選清單裡找不到的 id(超出一次取回的筆數、看不到的租戶、已刪除…)**不丟掉**:
 * 補一個佔位選項(`missing` 產生,文字「不在候選清單中」),照樣列成可取消的標籤,
 * 改別的值時原樣送回(同組織 / 權限欄位的做法)。佔位選項也放進 `options`,受控值才對得上。
 */
const withMissing = <T extends { id: string }>(
  candidates: readonly T[],
  ids: readonly string[],
  missing: (id: string) => T,
): { options: T[]; selected: T[] } => {
  const extra = ids
    .filter((id) => !candidates.some((option) => option.id === id))
    .map((id) => missing(id));
  const options = [...extra, ...candidates];
  return {
    options,
    selected: ids.flatMap((id) => {
      const found = options.find((option) => option.id === id);
      return found === undefined ? [] : [found];
    }),
  };
};

/**
 * 條件列的「值」:依欄位換控制項。
 * - 使用者:Autocomplete 多選
 * - 角色:Autocomplete 多選,依**擁有組織**分組(跨兩個以上擁有組織時才分;同 #372 的寫法)
 * - 所屬組織:使用處有動態來源時先選「指定組織 / 表單的組織欄位…」;指定組織用組織樹(`OrgTreeSelect`)
 * - 權限:可搜尋的模組 / 權限樹(`PermissionTreeSelect`)
 */
export const AudienceValueField = ({
  condition,
  env,
  hasError,
  onChange,
}: AudienceValueFieldProps) => {
  const t = useTranslations("admin.audiencePicker");
  const ids = staticValues(condition.value);
  const setIds = (next: string[]) => {
    onChange({ kind: "static", values: next });
  };

  if (condition.field === "user") {
    const users = withMissing(env.options.users, ids, (id) => ({
      id,
      label: t("outOfList"),
    }));
    return (
      <Autocomplete<AudienceUserOption, true>
        multiple
        size="small"
        label={t("value")}
        options={users.options}
        value={users.selected}
        chipDeleteIcon="close"
        error={hasError}
        disabled={env.isReadOnly}
        noOptionsText={t("empty")}
        sx={{ width: 300 }}
        getOptionKey={(option) => option.id}
        getOptionLabel={(option) => option.label}
        onChange={(next) => {
          setIds(next.map((option) => option.id));
        }}
      />
    );
  }

  if (condition.field === "role") {
    const roles = withMissing(env.options.roles, ids, (id) => ({
      id,
      name: t("outOfList"),
      label: t("outOfList"),
      ownerOrgId: null,
      ownerOrgName: null,
      tenantTopId: null,
      tenantTopName: null,
    }));
    const groupBy = shouldGroupRolesByOwnerOrg(roles.options)
      ? (option: RoleMenuOption) =>
          roleOwnerOrgGroupNameOf(option, t("noOwnerOrg"))
      : undefined;
    return (
      <Autocomplete<RoleMenuOption, true>
        multiple
        size="small"
        label={t("value")}
        options={roles.options}
        value={roles.selected}
        chipDeleteIcon="close"
        error={hasError}
        disabled={env.isReadOnly}
        noOptionsText={t("empty")}
        sx={{ width: 300 }}
        groupBy={groupBy}
        getOptionKey={(option) => option.id}
        getOptionLabel={(option) => option.name}
        getOptionSecondaryText={(option) => option.ownerOrgName}
        onChange={(next) => {
          setIds(next.map((option) => option.id));
        }}
      />
    );
  }

  if (condition.field === "permission") {
    return (
      <PermissionTreeSelect
        label={t("value")}
        value={ids}
        modules={env.options.permissionModules}
        isLoading={env.options.isPermissionsLoading}
        isError={env.options.isPermissionsError}
        error={hasError}
        disabled={env.isReadOnly}
        onChange={setIds}
      />
    );
  }

  // 所屬組織
  const hasStatic = env.orgSources.some((source) => source.kind === "static");
  const dynamicSources = env.orgSources.flatMap((source) =>
    source.kind === "dynamic" ? [source] : [],
  );
  const sourceValue =
    condition.value.kind === "dynamic"
      ? `${DYNAMIC_PREFIX}${condition.value.ref}`
      : STATIC_SOURCE;

  return (
    <>
      {dynamicSources.length > 0 && (
        <SelectField
          size="small"
          label={t("orgSource")}
          value={sourceValue}
          error={hasError && condition.value.kind === "dynamic"}
          disabled={env.isReadOnly}
          sx={{ width: 190 }}
          options={[
            ...(hasStatic
              ? [{ value: STATIC_SOURCE, label: t("orgStatic") }]
              : []),
            ...dynamicSources.map((source) => ({
              value: `${DYNAMIC_PREFIX}${source.ref}`,
              label: source.label,
            })),
          ]}
          onChange={(next) => {
            const picked = dynamicSources.find(
              (source) => `${DYNAMIC_PREFIX}${source.ref}` === next,
            );
            onChange(
              picked === undefined
                ? { kind: "static", values: [] }
                : { kind: "dynamic", ref: picked.ref },
            );
          }}
        />
      )}
      {condition.value.kind === "static" && (
        <Box sx={{ width: 300 }}>
          <OrgTreeSelect
            label={dynamicSources.length > 0 ? t("orgPick") : t("value")}
            value={ids}
            isMultiSelect
            error={hasError}
            disabled={env.isReadOnly}
            size="small"
            onChange={setIds}
            fullWidth
          />
        </Box>
      )}
    </>
  );
};
