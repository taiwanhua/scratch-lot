import {
  FORM_UPLOAD_CONTENT_TYPES,
  type FieldDef,
  uploadLimitsOf,
} from "@repo/domain/form";

/**
 * 上傳欄的檔型分組(設計器「檔型 / 大小上限」勾選用;Spec 6a §5 表 A)。一組 = 一種副檔名,
 * `.zip` 在 Windows 上會被申報成 `application/x-zip-compressed`,與 `application/zip` 同一組一起勾。
 * 正本是 `@repo/domain/form` 的 `FORM_UPLOAD_CONTENT_TYPES`(= api 的平台上限)。
 */
export const UPLOAD_TYPE_GROUPS = [
  { key: "png", types: ["image/png"] },
  { key: "jpg", types: ["image/jpeg"] },
  { key: "webp", types: ["image/webp"] },
  { key: "pdf", types: ["application/pdf"] },
  { key: "doc", types: ["application/msword"] },
  {
    key: "docx",
    types: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  { key: "xls", types: ["application/vnd.ms-excel"] },
  {
    key: "xlsx",
    types: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  { key: "zip", types: ["application/zip", "application/x-zip-compressed"] },
] as const satisfies readonly {
  key: string;
  types: readonly (typeof FORM_UPLOAD_CONTENT_TYPES)[number][];
}[];

export type UploadTypeGroupKey = (typeof UPLOAD_TYPE_GROUPS)[number]["key"];

/** 欄位目前允許的分組(沒設 = 全部)。 */
export const acceptedGroupsOf = (field: FieldDef): UploadTypeGroupKey[] => {
  const accepted = new Set(uploadLimitsOf(field).accept);
  return UPLOAD_TYPE_GROUPS.filter((group) =>
    group.types.every((type) => accepted.has(type)),
  ).map((group) => group.key);
};

/** 勾選的分組 → `widget.accept`;全勾(= 平台全部)回 undefined(不存這個設定)。 */
export const acceptOfGroups = (
  keys: readonly UploadTypeGroupKey[],
): string[] | undefined => {
  if (keys.length === UPLOAD_TYPE_GROUPS.length) {
    return undefined;
  }
  return UPLOAD_TYPE_GROUPS.filter((group) => keys.includes(group.key)).flatMap(
    (group) => [...group.types],
  );
};

/** 上傳提示用的副檔名清單(例:`PDF / PNG`)。 */
export const acceptedExtensionsText = (field: FieldDef): string =>
  acceptedGroupsOf(field)
    .map((key) => key.toUpperCase())
    .join(" / ");
