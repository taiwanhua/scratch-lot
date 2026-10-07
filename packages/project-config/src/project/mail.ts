import type { ProjectMailConfig } from "../base/mail-config";
import { projectPublic } from "./public";

/**
 * 專案的信件寄件識別(專案維護;登記於 docs/branding.md)。寄件網域須在 Resend 完成
 * SPF / DKIM 驗證(ADR-0010)。不含 API key —— 機密仍走 Secret Manager。
 */
export const projectMail = {
  brandName: projectPublic.brand.name,
  senderEmail: "no-reply@scratch-lot.com",
  signature: `${projectPublic.brand.name} 後台管理系統`,
} satisfies ProjectMailConfig;
