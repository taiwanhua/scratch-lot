import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

/** 配對碼顯示成兩段(`8K3M-Q7PZ`,人要從畫面抄到店內電腦);複製的是 8 碼本身,代理程式兩種都收。 */
const formatPairingCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

export interface PairingInfoProps {
  pairingCode: string;
  /** 配對碼到期時間(ISO) */
  expiresAt: string;
}

/**
 * 配對資訊(Figma BS-10b 289:92651):伺服器網址與 8 碼配對碼,各附 [複製]。
 * 伺服器網址 = 後台自己打的 API origin(與 GraphQL 同一台,不另設環境變數;docs/modules/printers.md「配對」)。
 * 配對碼只在產生時回一次,關掉就看不到了,要再拿得 [重新配對]。
 */
export const PairingInfo = ({ pairingCode, expiresAt }: PairingInfoProps) => {
  const t = useTranslations("admin.printers.pairing");
  const { session } = useSession();
  const show = useSnackbar();
  const temporalText = useTemporalText();
  const serverUrl = new URL(session.endpoint).origin;

  const copy = (label: string, text: string) => {
    // 非安全連線(http)時瀏覽器沒有 clipboard:同步丟錯也走失敗提示
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => {
          show("success", t("copied", { label }));
        },
        () => {
          show("error", t("copyFailed"));
        },
      );
  };

  const row = (
    label: string,
    value: string,
    copyText: string,
    isCode = false,
  ) => (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 64 }}
      >
        {label}
      </Typography>
      <Typography
        variant={isCode ? "h6" : "body2"}
        sx={{ flex: 1, wordBreak: "break-all" }}
      >
        {value}
      </Typography>
      <Button
        size="small"
        variant="text"
        aria-label={t("copyOf", { label })}
        onClick={() => {
          copy(label, copyText);
        }}
      >
        {t("copy")}
      </Button>
    </Stack>
  );

  return (
    <Box sx={{ bgcolor: "grey.50", borderRadius: 1, px: 2, py: 1.5 }}>
      <Stack spacing={1}>
        {row(t("serverUrl"), serverUrl, serverUrl)}
        {row(t("code"), formatPairingCode(pairingCode), pairingCode, true)}
        <Typography variant="caption" color="text.secondary">
          {t("hint", { expiresAt: temporalText(expiresAt, "datetime") })}
        </Typography>
      </Stack>
    </Box>
  );
};
