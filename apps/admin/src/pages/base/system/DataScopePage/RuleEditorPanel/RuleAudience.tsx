import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";
import { Box } from "@repo/ui/box";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreePicker } from "@/components/base/OrgTreePicker/OrgTreePicker";
import { issueKey } from "@/lib/base/data-scope-issues";
import {
  type AudienceDraft,
  DataScopeAudienceType,
} from "@/lib/base/data-scope-rule";
import {
  roleOwnerOrgGroupNameOf,
  shouldGroupRolesByOwnerOrg,
} from "@/lib/base/role-options";

import type { DataScopeEditorEnv, PickerOption } from "../data-scope-types";

const AUDIENCE_TYPES = [
  DataScopeAudienceType.All,
  DataScopeAudienceType.Role,
  DataScopeAudienceType.Org,
  DataScopeAudienceType.User,
];

export interface RuleAudienceProps {
  audience: AudienceDraft;
  ruleIndex: number;
  env: DataScopeEditorEnv;
  onChange: (next: AudienceDraft) => void;
}

/**
 * 一條規則的套用對象(Figma 167:1719 的前兩個下拉):全部 / 角色 / 組織 / 使用者。
 *
 * 角色與使用者是 **Autocomplete 多選**(Figma `Draft/Autocomplete` 253:39):輸入即過濾、
 * 角色依**擁有組織**分組(#372)、每列主文字角色名 + 次文字擁有組織。在此之前是 MUI Select 多選 +
 * **選單外**一個搜尋框(Select 會把選單裡的子元素一律 clone 成 `role="option"`,
 * 搜尋框塞不進選單),#307 起那個外掛的搜尋框退場。
 *
 * **組織用組織樹**(`OrgTreePicker`,與使用者管理的「選擇所屬組織」同一個)—
 * 對象常常是「某個租戶頂層」,在樹上一眼看得出層級,攤平的清單看不出來。
 * 三種選擇器的清單都由 api 依**管理範圍**回,前端不另外過濾(ADR-0005)。
 */
export const RuleAudience = ({
  audience,
  ruleIndex,
  env,
  onChange,
}: RuleAudienceProps) => {
  const t = useTranslations("admin.dataScope.rule");
  const tReasons = useTranslations("admin.dataScope.reasons");

  const issue = env.issues.get(issueKey(ruleIndex, [], "audience"));
  const labelOf = (type: DataScopeAudienceType) =>
    ({
      [DataScopeAudienceType.All]: t("audienceAll"),
      [DataScopeAudienceType.Role]: t("audienceRole"),
      [DataScopeAudienceType.Org]: t("audienceOrg"),
      [DataScopeAudienceType.User]: t("audienceUser"),
    })[type];

  const options: readonly PickerOption[] =
    audience.type === DataScopeAudienceType.Role
      ? env.roleOptions
      : env.userOptions;

  const isList =
    audience.type === DataScopeAudienceType.Role ||
    audience.type === DataScopeAudienceType.User;
  const isRoleList = audience.type === DataScopeAudienceType.Role;

  /** 受控值是 id 陣列,Autocomplete 收的是選項物件 —— 在這裡對照回來。 */
  const selected = audience.ids.flatMap((id) => {
    const found = options.find((option) => option.id === id);
    return found === undefined ? [] : [found];
  });

  /**
   * 角色清單才分組,而且只在跨兩個以上**擁有組織**時分(`lib/base/role-options.ts`)。
   * 使用者清單維持不分組 —— 它的 label 已含帳號,不會同名難辨。
   *
   * **以擁有組織為組、不是租戶頂層**(#372):同一個租戶底下可以有很多個擁有組織,
   * 用租戶頂層當組標題時,同一個標題底下混著好幾個組織的角色;而 MUI 的 `groupBy`
   * 只合併**相鄰**的同值,所以同一個租戶的標題還會重複出現。清單的排序在
   * `useDataScopeData`(`sortRolesByOwnerOrg`),這裡只負責取組標題。
   */
  const groupBy =
    isRoleList && shouldGroupRolesByOwnerOrg(options)
      ? (option: PickerOption) =>
          roleOwnerOrgGroupNameOf(option, t("audienceNoOwnerOrg"))
      : undefined;

  // 存著的人員條件這一版畫面表達不出來(多個條件列、權限、含下層…):只顯示唯讀提示,
  // 不假裝成「所有人」;儲存時原樣送回
  if (audience.preserved !== undefined) {
    return (
      <Stack spacing={0.75}>
        <Typography variant="body2">
          {t("audience")}:{t("audiencePreserved")}
        </Typography>
        {issue !== undefined && (
          <Typography variant="caption" color="error.main">
            {tReasons(issue.reason)}
          </Typography>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <SelectField
          size="small"
          label={t("audience")}
          value={audience.type}
          disabled={env.isReadOnly}
          sx={{ width: 150 }}
          options={AUDIENCE_TYPES.map((type) => ({
            value: type,
            label: labelOf(type),
          }))}
          onChange={(type) => {
            // 換了種類,原本選的對象就不是同一種東西了,一律清空
            onChange({ type, ids: [] });
          }}
        />

        {isList && (
          <Autocomplete<PickerOption, true>
            multiple
            size="small"
            label={t("audienceTargets")}
            options={options}
            value={selected}
            error={issue !== undefined}
            disabled={env.isReadOnly}
            noOptionsText={t("audienceEmpty")}
            sx={{ width: 320 }}
            groupBy={groupBy}
            getOptionKey={(option) => option.id}
            // 角色的主文字是角色名、次文字是擁有組織;使用者的 label 已含帳號,沒有次文字
            getOptionLabel={(option) =>
              isRoleList ? (option.name ?? option.label) : option.label
            }
            getOptionSecondaryText={(option) =>
              isRoleList ? option.ownerOrgName : null
            }
            onChange={(next) => {
              onChange({
                type: audience.type,
                ids: next.map((option) => option.id),
              });
            }}
          />
        )}
      </Stack>

      {audience.type === DataScopeAudienceType.Org && (
        <Box
          sx={{
            border: 1,
            borderColor: issue === undefined ? "divider" : "error.main",
            borderRadius: 1,
            p: 1,
            width: 400,
          }}
        >
          <OrgTreePicker
            nodes={env.orgNodes}
            isMultiSelect
            selectedIds={audience.ids}
            maxHeight={180}
            aria-label={t("audienceOrg")}
            onSelectedIdsChange={(ids) => {
              onChange({ type: audience.type, ids });
            }}
          />
        </Box>
      )}

      {issue !== undefined && (
        <Typography variant="caption" color="error.main">
          {tReasons(issue.reason)}
        </Typography>
      )}
    </Stack>
  );
};
