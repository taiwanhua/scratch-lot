import { useTranslations } from "use-intl";

import { AUDIENCE_FIELDS, type AudienceField } from "@repo/domain/audience";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ConditionGroup } from "@/components/base/condition-tree/ConditionGroup";
import {
  type AudienceConditionDraft,
  type AudienceDraft,
  type AudienceIssueTarget,
  type AudienceMode,
  type AudienceOrgSourceOption,
  audienceIssueKey,
  newAudienceCondition,
} from "@/lib/base/audience-draft";

import { AudienceConditionRow } from "./AudienceConditionRow";
import type { AudiencePickerEnv } from "./audience-picker-env";
import { useAudienceOptions } from "./useAudienceOptions";

const STATIC_ONLY: readonly AudienceOrgSourceOption[] = [{ kind: "static" }];
const NO_ISSUES: ReadonlyMap<string, string> = new Map();

export interface AudiencePickerProps {
  /** 依用途命名:套用對象 / 審核者 / 知會對象 / 通知對象 / 收件人 */
  title: string;
  /** 外框已經標了用途(例:對話框標題「審核者條件」)時不再顯示標題;仍當區塊的無障礙名稱 */
  isTitleHidden?: boolean;
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  /** 能不能選「所有人」(只有資料範圍可以;其餘使用處一定要設條件) */
  allowAll: boolean;
  /** 這個使用處開放的欄位(預設全部:使用者 / 角色 / 所屬組織 / 權限) */
  fields?: readonly AudienceField[];
  /** 所屬組織可選的來源(預設只有指定組織);dynamic 帶顯示名稱 */
  orgSources?: readonly AudienceOrgSourceOption[];
  /** `audienceIssueKey(childPath, target)` → 錯誤文字(本地驗證與 api 的 path 都換成這張表) */
  issues?: ReadonlyMap<string, string>;
  isReadOnly?: boolean;
}

/**
 * 人員條件編輯器(Figma `Draft/AudiencePicker`,
 * 變體 所有人 / 符合條件 / 不允許所有人)。
 *
 * - 頂層明確二選一:「所有人」/「符合條件」;選所有人時條件樹收起,**切回來保留先前內容**
 *   (`AudienceDraft.filter` 一直留著,送出時 `toAudienceJson` 才丟掉)。
 * - 條件樹與資料範圍的條件組合共用 `ConditionGroup` / `ConditionRow`,只換欄位清單;上限 3 層、空群組不允許。
 * - 錯誤由呼叫端把 api 的 `path`(`audienceIssueFromPath`)或本地驗證換成 `issues` 表傳進來,標在出錯的那一列。
 */
export const AudiencePicker = ({
  title,
  isTitleHidden = false,
  value,
  onChange,
  allowAll,
  fields = AUDIENCE_FIELDS,
  orgSources = STATIC_ONLY,
  issues = NO_ISSUES,
  isReadOnly = false,
}: AudiencePickerProps) => {
  const t = useTranslations("admin.audiencePicker");
  const options = useAudienceOptions(fields);

  const issueOf = (
    childPath: readonly number[],
    target: AudienceIssueTarget,
  ): string | undefined => issues.get(audienceIssueKey(childPath, target));
  const env: AudiencePickerEnv = {
    fields,
    orgSources,
    options,
    issueOf,
    isReadOnly,
  };
  const modeError = issueOf([], "mode");
  const isMatch = !allowAll || value.mode === "match";
  const firstField = fields.at(0);

  return (
    <Stack component="section" aria-label={title} spacing={1}>
      {!isTitleHidden && (
        <Typography variant="subtitle2" color="textSecondary">
          {title}
        </Typography>
      )}
      {allowAll && (
        <RadioGroup
          row
          aria-label={title}
          value={value.mode}
          onChange={(_event, mode) => {
            onChange({ ...value, mode: mode as AudienceMode });
          }}
        >
          <FormControlLabel
            value="all"
            control={<Radio disabled={isReadOnly} />}
            label={t("modeAll")}
          />
          <FormControlLabel
            value="match"
            control={<Radio disabled={isReadOnly} />}
            label={t("modeMatch")}
          />
        </RadioGroup>
      )}
      {modeError !== undefined && (
        <Typography variant="caption" color="error">
          {modeError}
        </Typography>
      )}
      {isMatch && (
        <ConditionGroup<AudienceConditionDraft>
          group={value.filter}
          childPath={[]}
          isReadOnly={isReadOnly}
          createCondition={
            firstField === undefined
              ? undefined
              : () => newAudienceCondition(firstField, orgSources)
          }
          errorOf={(childPath) =>
            issueOf(childPath, "group") ?? issueOf(childPath, "node")
          }
          renderCondition={(condition, childPath, handlers) => (
            <AudienceConditionRow
              condition={condition}
              childPath={childPath}
              env={env}
              onChange={handlers.onChange}
              onRemove={handlers.onRemove}
            />
          )}
          onChange={(filter) => {
            onChange({ ...value, filter });
          }}
        />
      )}
    </Stack>
  );
};
