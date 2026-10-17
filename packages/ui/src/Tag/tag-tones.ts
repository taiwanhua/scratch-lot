/** 標籤色調(Figma Draft/Tag 76:722 的 Tone 變體軸)。 */
export type TagTone = "grey" | "primary" | "success" | "warning" | "error";

/**
 * 每個色調的底色與字色(語意 token;grey 沒有 lighter / darker,改用灰階兩階)。
 * `Tag` 與班表頂部群組的彙總格(`RosterGrid`)共用,兩處同一組顏色。
 */
export const tagToneStyles: Record<
  TagTone,
  { bgcolor: string; color: string }
> = {
  grey: { bgcolor: "grey.200", color: "grey.700" },
  primary: { bgcolor: "primary.lighter", color: "primary.darker" },
  success: { bgcolor: "success.lighter", color: "success.darker" },
  warning: { bgcolor: "warning.lighter", color: "warning.darker" },
  error: { bgcolor: "error.lighter", color: "error.darker" },
};
