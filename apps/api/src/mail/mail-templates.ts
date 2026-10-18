import { projectMail } from "@repo/project-config/mail";

import { formatMailSender } from "./mail-sender";
import type {
  ActionEmailInput,
  MailMessage,
  NotificationEmailInput,
} from "./mail.service";

/*
 * 信件模板(文案繁中)。品牌名、寄件信箱與署名是專案值,正本在 `@repo/project-config/mail`
 * (登記於 docs/branding.md);這裡只負責組出寄件人與套進模板。
 */

/**
 * 寄件人 `品牌名 <寄件信箱>`(ADR-0010;寄件網域的 SPF / DKIM 由使用者在 Resend 完成驗證)。
 * 品牌名含 RFC 特殊符號時由 `formatMailSender` 包成 quoted-string;主旨與內文仍用原文。
 */
export const MAIL_SENDER = formatMailSender(
  projectMail.brandName,
  projectMail.senderEmail,
);

const BRAND_NAME = projectMail.brandName;
const SIGNATURE = projectMail.signature;

/** 到期時間以台灣時區顯示(收件人是後台使用者,皆在台灣)。 */
const EXPIRY_FORMAT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function buildActivationEmail(input: ActionEmailInput): MailMessage {
  const expiry = EXPIRY_FORMAT.format(input.expiresAt);
  const paragraphs = [
    `${input.name} 您好:`,
    `您的 ${BRAND_NAME} 後台帳號已建立。請在 ${expiry} 前開啟以下連結設定密碼,完成啟用:`,
    input.link,
    "此連結只能使用一次;若已逾期,請在登入頁點「忘記密碼」重新取得連結。",
    "若您沒有申請這個帳號,請忽略此信。",
    SIGNATURE,
  ];
  return {
    kind: "activation",
    to: input.to,
    link: input.link,
    subject: `【${BRAND_NAME}】啟用您的後台帳號`,
    text: paragraphs.join("\n\n"),
    html: toHtml(paragraphs, input.link),
  };
}

export function buildPasswordResetEmail(input: ActionEmailInput): MailMessage {
  const expiry = EXPIRY_FORMAT.format(input.expiresAt);
  const paragraphs = [
    `${input.name} 您好:`,
    `我們收到您重設密碼的申請。請在 ${expiry} 前開啟以下連結設定新密碼:`,
    input.link,
    "此連結只能使用一次;若已逾期,請在登入頁重新申請。",
    "若這不是您本人的操作,請忽略此信,您的密碼不會改變。",
    SIGNATURE,
  ];
  return {
    kind: "password-reset",
    to: input.to,
    link: input.link,
    subject: `【${BRAND_NAME}】重設密碼`,
    text: paragraphs.join("\n\n"),
    html: toHtml(paragraphs, input.link),
  };
}

/**
 * 通知信(通知的 email 管道):主旨與內容就是通知的標題與內容(類型範本產生,
 * 與站內通知同一份),有連結時附上。
 */
export function buildNotificationEmail(
  input: NotificationEmailInput,
): MailMessage {
  const frame = notificationFrameOf(input.locale);
  const paragraphs = [
    frame.greeting(input.name),
    input.body,
    ...(input.link === null ? [] : [frame.linkIntro, input.link]),
    frame.signature,
  ];
  return {
    kind: "notification",
    notificationType: input.notificationType,
    to: input.to,
    link: input.link,
    subject: `【${BRAND_NAME}】${input.title}`,
    text: paragraphs.join("\n\n"),
    html: toHtml(paragraphs, input.link),
  };
}

/** 通知信外框(問候語、連結說明、署名)的語系;內文已由通知類型的範本以同一個語言產生。 */
interface NotificationFrame {
  greeting: (name: string) => string;
  linkIntro: string;
  signature: string;
}

const NOTIFICATION_FRAMES: Readonly<Record<"zh-TW" | "en", NotificationFrame>> =
  {
    "zh-TW": {
      greeting: (name) => `${name} 您好:`,
      linkIntro: "請開啟以下連結查看:",
      signature: SIGNATURE,
    },
    // 專案設定的署名只有一份(繁中),英文外框以品牌名署名
    en: {
      greeting: (name) => `Hi ${name},`,
      linkIntro: "Open the link below for details:",
      signature: BRAND_NAME,
    },
  };

/** 收件人語言 → 外框:英文(`en`、`en-US`…)用英文,其餘一律繁中。 */
function notificationFrameOf(locale: string | null): NotificationFrame {
  const [language] = (locale ?? "").split("-", 1);
  return language === "en"
    ? NOTIFICATION_FRAMES.en
    : NOTIFICATION_FRAMES["zh-TW"];
}

/** 純文字段落轉最簡 HTML:連結那一段做成可點的 <a>,其餘逐段 <p>;內容一律跳脫。 */
function toHtml(paragraphs: string[], link: string | null): string {
  const body = paragraphs
    .map((paragraph) =>
      link !== null && paragraph === link
        ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
        : `<p>${escapeHtml(paragraph)}</p>`,
    )
    .join("\n");
  return `<!doctype html><html lang="zh-Hant"><body>\n${body}\n</body></html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replaceAll(/["&'<>]/g, (char) => HTML_ESCAPES[char] ?? char);
}
