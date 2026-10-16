import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";

export interface JsonPreviewProps {
  value: unknown;
  /** 無障礙名稱(這一段 JSON 是什麼) */
  label: string;
  maxHeight?: number;
}

/** 唯讀的 JSON 預覽 + 複製(設計器:整份定義、各表達式;Spec 6a §5 不做文字輸入,所以只給看、不給改)。 */
export const JsonPreview = ({
  value,
  label,
  maxHeight = 240,
}: JsonPreviewProps) => {
  const t = useTranslations("admin.forms.designer");
  const showSnackbar = useSnackbar();
  const text = JSON.stringify(value, null, 2);

  return (
    <Stack spacing={0.5}>
      <Box
        component="pre"
        aria-label={label}
        tabIndex={0}
        sx={{
          m: 0,
          p: 1,
          maxHeight,
          overflow: "auto",
          bgcolor: "action.hover",
          borderRadius: 1,
          typography: "caption",
          fontFamily: "monospace",
        }}
      >
        {text}
      </Box>
      <Stack direction="row">
        <Button
          variant="text"
          size="small"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => {
                showSnackbar("success", t("copied"));
              },
              () => {
                showSnackbar("error", t("copyFailed"));
              },
            );
          }}
        >
          {t("copy")}
        </Button>
      </Stack>
    </Stack>
  );
};
