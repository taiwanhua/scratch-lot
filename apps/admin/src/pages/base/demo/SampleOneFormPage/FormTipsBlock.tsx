import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Typography } from "@repo/ui/typography";

import { SAMPLE_ONE_I18N } from "../demo-sample-one-config";

/**
 * 填寫提示區塊(Figma 177:559)。**頁面自有權限的示範**:只在新增頁出現,
 * 而且要持有新增頁自己的 `create-page.show-tips` —— 與「能不能新增」是兩回事,
 * 沒有這個權限的人照樣新增得了,只是看不到提示。顯示與否由呼叫端判斷。
 */
export const FormTipsBlock = () => {
  const t = useTranslations(`${SAMPLE_ONE_I18N}.tips`);

  return (
    <Box
      component="section"
      aria-label={t("region")}
      sx={{ bgcolor: "background.default", borderRadius: 1, px: 1.5, py: 1.25 }}
    >
      <Typography variant="caption" color="textSecondary">
        {t("body")}
      </Typography>
    </Box>
  );
};
