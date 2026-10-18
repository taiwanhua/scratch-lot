import { useState } from "react";

import { isValidOrgSlug } from "@repo/domain/form-keys";
import { OrgVisibility } from "@repo/graphql";

import type { OrgDetail } from "../org-manager-types";

export interface EditOrgFormState {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  /** 新的上層組織(搬移);沒改就等於原本的 `parentId` */
  parentId: string;
  setParentId: (value: string) => void;
  /** 新選的商標檔案;null = 這次不換商標,或者把既有商標移除了 */
  logoFile: File | null;
  setLogoFile: (file: File | null) => void;
  /**
   * 使用者碰過商標欄(選了新檔或按了移除)。
   * 沒碰過就**不送 `logoPath`** — `UpdateOrgInput` 的 `logoPath: null` 在 api 是「清空」,
   * 沒有這個旗標的話,只改名稱也會把既有商標連帶刪掉。
   */
  isLogoTouched: boolean;
  ownerUserId: string;
  setOwnerUserId: (value: string) => void;
  visibility: OrgVisibility;
  setVisibility: (value: OrgVisibility) => void;
  /** 租戶時區(IANA 名稱);null = 沒設、使用預設時區 */
  timezone: string | null;
  setTimezone: (value: string | null) => void;
  /** 租戶短碼(只有租戶頂層有;只有根組織改得動,欄位出不出現由 `TenantTopFields` 決定) */
  slug: string;
  setSlug: (value: string) => void;
  /** 短碼改過且格式不符(`@repo/domain/form` 的 `isValidOrgSlug`,與 api 同一條) */
  isSlugInvalid: boolean;
  isValid: boolean;
  /** 各個 mutation 要不要送(沒變動的欄位不送,api 也不會留空的審計紀錄) */
  changes: {
    hasProfileChange: boolean;
    /** 短碼改了(隨 `updateOrg` 一起送;沒改就不帶 `slug`,api 視為不動) */
    hasSlugChange: boolean;
    hasMove: boolean;
    hasOwnerChange: boolean;
    hasVisibilityChange: boolean;
    hasTimezoneChange: boolean;
  };
}

/**
 * 編輯組織表單(Figma 88:168)。彈窗關閉即卸載,初始值在掛載時從 props 進 `useState`,
 * 不用 effect 同步(REACT-06)。
 *
 * 各欄位群各自對到**不同的 mutation**:名稱 / 描述 / 商標 → `updateOrg`、上層組織 →
 * `moveOrg`、擁有者 → `transferOrgOwner`、可見範圍 → `setOrgVisibility`、時區 → `setOrgTimezone`。
 * 這不是前端的湊合:`UpdateOrgInput` 根本沒有後四者的欄位(`docs/modules/org-manager.md`),
 * 所以「哪些變了」要在這裡算出來,送出時才知道要打哪幾個。
 */
export const useEditOrgForm = (org: OrgDetail): EditOrgFormState => {
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [parentId, setParentId] = useState(org.parentId ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isLogoTouched, setIsLogoTouched] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState(org.ownerUserId ?? "");
  const [visibility, setVisibility] = useState(
    org.visibility ?? OrgVisibility.Own,
  );
  const [timezone, setTimezone] = useState(org.timezone ?? null);
  const [slug, setSlug] = useState(org.slug ?? "");

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const trimmedSlug = slug.trim();
  const hasSlugChange = trimmedSlug !== (org.slug ?? "");
  const isSlugInvalid = hasSlugChange && !isValidOrgSlug(trimmedSlug);

  return {
    name,
    setName,
    description,
    setDescription,
    parentId,
    setParentId,
    logoFile,
    setLogoFile: (file: File | null) => {
      setIsLogoTouched(true);
      setLogoFile(file);
    },
    isLogoTouched,
    ownerUserId,
    setOwnerUserId,
    visibility,
    setVisibility,
    timezone,
    setTimezone,
    slug,
    setSlug,
    isSlugInvalid,
    isValid: trimmedName !== "" && !isSlugInvalid,
    changes: {
      hasProfileChange:
        trimmedName !== org.name ||
        trimmedDescription !== (org.description ?? "") ||
        isLogoTouched ||
        hasSlugChange,
      hasSlugChange,
      hasMove: parentId !== "" && parentId !== (org.parentId ?? ""),
      hasOwnerChange:
        ownerUserId !== "" && ownerUserId !== (org.ownerUserId ?? ""),
      hasVisibilityChange:
        org.visibility !== null && visibility !== org.visibility,
      hasTimezoneChange: timezone !== (org.timezone ?? null),
    },
  };
};
