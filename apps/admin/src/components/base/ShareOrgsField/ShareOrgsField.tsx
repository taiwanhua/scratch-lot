import { type ReactNode, useMemo } from "react";
import { useTranslations } from "use-intl";

import { useTenantOrgTreeQuery } from "@repo/graphql";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useIsAtRootOrg } from "@/hooks/base/useIsAtRootOrg";
import { useSession } from "@/hooks/base/useSession";
import { flattenOrgs, tenantTreeToOrgNodes } from "@/lib/base/org-tree";

/** 「共用給」的一筆(api 的 `ShareOrg` / `ShareOrgInput`)。 */
export interface ShareOrgValue {
  orgId: string;
  includeDescendants: boolean;
}

export interface ShareOrgsFieldProps {
  /** 浮動標籤(呼叫端的欄位名,例「共用給」) */
  label: string;
  value: readonly ShareOrgValue[];
  onChange: (value: ShareOrgValue[]) => void;
  helperText?: ReactNode;
  error?: boolean;
  disabled?: boolean;
  /** 欄位寬度(px);不給 = 撐滿 */
  width?: number;
  /** 輸入格高度,跟著同一張表單其他欄位給;預設 `medium`(同 `TextField`) */
  size?: "small" | "medium";
}

/** 租戶組織樹攤平 + 根組織的 id(與 `OrgTreeSelect` 同一支查詢,共用快取)。 */
const useTenantOrgs = () => {
  const { session } = useSession();
  const tree = useTenantOrgTreeQuery(session.client);
  return useMemo(() => {
    const nodes = tree.data?.tenantOrgTree ?? [];
    return {
      orgs: flattenOrgs(tenantTreeToOrgNodes(nodes, false)),
      // 樹的頂層節點(parentId 一律 null):租戶的人看到的是租戶頂層,站在根組織時是根組織本身
      topIds: nodes
        .filter((node) => (node.parentId ?? null) === null)
        .map((node) => node.id),
    };
  }, [tree.data]);
};

/** 已選組織的 id → 名稱。 */
const useTenantOrgNames = (): ReadonlyMap<string, string> => {
  const { orgs } = useTenantOrgs();
  return useMemo(() => new Map(orgs.map((org) => [org.id, org.name])), [orgs]);
};

/**
 * 「共用給」欄位(資料共用,ADR-0014):`OrgTreeSelect` 的 `scope="tenant"` 多選 ——
 * 整個租戶的組織都能選(包含自己看不到的;共用只讓對方看得到,不讓自己看更多),
 * 每個已選的組織下方各一個「含下層」勾選框。選最上層組織並勾含下層 = 全部分店。
 *
 * 值的形狀就是 api 的 `ShareOrgInput[]`(整份清單一次送);取消一個組織時它的「含下層」一起拿掉。
 */
export const ShareOrgsField = ({
  label,
  value,
  onChange,
  helperText,
  error,
  disabled,
  width,
  size,
}: ShareOrgsFieldProps) => {
  const t = useTranslations("admin.shareOrgsField");
  const { topIds } = useTenantOrgs();
  const names = useTenantOrgNames();
  const ids = value.map((item) => item.orgId);
  // 根組織不屬於任何租戶:樹上的根組織反灰;站在根組織時整欄停用(根組織的資料不能共用,api 也會擋)
  const isAtRoot = useIsAtRootOrg() === true;
  const rootReasons = useMemo(
    () =>
      isAtRoot
        ? Object.fromEntries(topIds.map((id) => [id, t("rootNotSharable")]))
        : {},
    [isAtRoot, topIds, t],
  );

  return (
    <Stack spacing={0.5} sx={{ width: width ?? "100%", maxWidth: "100%" }}>
      <OrgTreeSelect
        scope="tenant"
        isMultiSelect
        fullWidth
        size={size}
        label={label}
        value={ids}
        disabled={disabled === true || isAtRoot}
        disabledReasons={rootReasons}
        error={error}
        helperText={isAtRoot ? t("rootDisabled") : (helperText ?? t("helper"))}
        onChange={(next) => {
          onChange(
            next.map(
              (orgId) =>
                value.find((item) => item.orgId === orgId) ?? {
                  orgId,
                  includeDescendants: false,
                },
            ),
          );
        }}
      />
      {value.length > 0 && (
        <Stack sx={{ pl: 1.5 }}>
          {value.map((item) => (
            <FormControlLabel
              key={item.orgId}
              disabled={disabled === true || isAtRoot}
              label={t("includeDescendants", {
                name: names.get(item.orgId) ?? t("unknownOrg"),
              })}
              control={
                <Checkbox
                  size="small"
                  checked={item.includeDescendants}
                  onChange={(_event, checked) => {
                    onChange(
                      value.map((entry) =>
                        entry.orgId === item.orgId
                          ? { ...entry, includeDescendants: checked }
                          : entry,
                      ),
                    );
                  }}
                />
              }
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

/** 唯讀顯示(詳情頁):「中山店、總部(含下層)」;空 = 不共用。 */
export const ShareOrgsText = ({
  value,
}: {
  value: readonly ShareOrgValue[];
}) => {
  const t = useTranslations("admin.shareOrgsField");
  const names = useTenantOrgNames();
  if (value.length === 0) {
    return <>{t("none")}</>;
  }
  return (
    <>
      {value
        .map((item) => {
          const name = names.get(item.orgId) ?? t("unknownOrg");
          return item.includeDescendants
            ? t("withDescendants", { name })
            : name;
        })
        .join("、")}
    </>
  );
};
