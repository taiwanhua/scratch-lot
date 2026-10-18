import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import {
  PrintAgentPlatform,
  usePrintAgentDownloadUrlQuery,
  usePrintAgentReleaseQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  PRINT_AGENT_PLATFORMS,
  browserPlatformHints,
  suggestedPrintAgentPlatform,
} from "@/lib/base/print-agent-platform";

import { printersErrorOf } from "../printers-error";
import { startDownload } from "./start-download";

const PLATFORM_LABEL_KEY: Record<PrintAgentPlatform, string> = {
  [PrintAgentPlatform.WindowsX64]: "windowsX64",
  [PrintAgentPlatform.LinuxX64]: "linuxX64",
  [PrintAgentPlatform.LinuxArm64]: "linuxArm64",
  [PrintAgentPlatform.MacosArm64]: "macosArm64",
};

/**
 * 代理程式分頁上方的下載區:
 * 「最新版本 x.y.z」+ 四個下載按鈕,依瀏覽器偵測的系統反白建議的那個。
 * 按下時才向 api 要簽名網址(1 小時),所以不會拿到過期的網址。
 * 只在有 `system.printers.create` 時掛上(呼叫端判斷)。
 */
export const AgentDownloadPanel = () => {
  const t = useTranslations("admin.printers.download");
  const tErrors = useTranslations("admin.printers.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const show = useSnackbar();
  const release = usePrintAgentReleaseQuery(session.client);
  const suggested = suggestedPrintAgentPlatform(browserPlatformHints());
  const latestVersion = release.data?.printAgentRelease.latestVersion ?? null;
  const published = new Set(
    release.data?.printAgentRelease.files.map((file) => file.platform),
  );

  const download = async (platform: PrintAgentPlatform) => {
    const variables = { input: { platform } };
    try {
      const data = await queryClient.fetchQuery({
        queryKey: usePrintAgentDownloadUrlQuery.getKey(variables),
        queryFn: usePrintAgentDownloadUrlQuery.fetcher(
          session.client,
          variables,
        ),
        // 簽名網址每按一次現簽,不吃快取
        staleTime: 0,
      });
      const { url, file } = data.printAgentDownloadUrl;
      startDownload(url, file.name);
    } catch (error) {
      show("error", tErrors(printersErrorOf(error).code));
    }
  };

  return (
    <Box sx={{ bgcolor: "grey.50", borderRadius: 1, px: 2, py: 1.5 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle2">
          {latestVersion === null
            ? t("title")
            : t("titleWithVersion", { version: latestVersion })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("description")}
        </Typography>
        {release.isSuccess && latestVersion === null && (
          <Typography variant="body2" color="text.secondary">
            {t("notPublished")}
          </Typography>
        )}
        {latestVersion !== null && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            {PRINT_AGENT_PLATFORMS.filter((platform) =>
              published.has(platform),
            ).map((platform) => {
              const isSuggested = platform === suggested;
              const name = t(PLATFORM_LABEL_KEY[platform]);
              return (
                <Button
                  key={platform}
                  size="small"
                  variant={isSuggested ? "contained" : "outlined"}
                  onClick={() => {
                    void download(platform);
                  }}
                >
                  {isSuggested
                    ? t("buttonSuggested", { name })
                    : t("button", { name })}
                </Button>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};
