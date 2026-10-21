import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { injectScan } from "@/hooks/project/useScanner/scanner-registry";

import { REPEAT_WINDOW_MS, cameraReaderFactory } from "./camera-reader";
import { useSalesText } from "./useSalesText";

/** `Box` 的型別只認 div 的屬性;`<video>` 自己的屬性以展開傳入(手機自動播放要靜音、不全螢幕)。 */
const VIDEO_PROPS = { muted: true, playsInline: true } as const;

export interface CameraScanDialogProps {
  onClose: () => void;
}

/**
 * 相機掃描(專案規格 6.3、18.3;手機 / 平板):全螢幕相機框,可以連續掃描。讀到的碼注入 B10 全域掃描
 * (`injectScan`),和條碼槍走同一條路 —— 看板的銷售流程照常處理。同一個碼 2 秒內重複讀到只算一次。
 */
export const CameraScanDialog = ({ onClose }: CameraScanDialogProps) => {
  const { t } = useSalesText();
  // 對話框的內容在 portal 掛上後才有 <video>:用 state 的 ref,掛上後才開相機
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const recent = useRef<{ code: string; at: number } | null>(null);
  const onCode = useEffectEvent((code: string) => {
    const now = Date.now();
    const last = recent.current;
    if (last?.code === code && now - last.at < REPEAT_WINDOW_MS) {
      return;
    }
    recent.current = { code, at: now };
    setLastCode(code);
    injectScan(code);
  });
  useEffect(() => {
    if (video === null) {
      return;
    }
    let reading: { stop: () => void } | null = null;
    let cancelled = false;
    cameraReaderFactory()(video, (code) => {
      onCode(code);
    })
      .then((opened) => {
        if (cancelled) {
          opened.stop();
          return;
        }
        reading = opened;
      })
      .catch(() => {
        setFailed(true);
      });
    return () => {
      cancelled = true;
      reading?.stop();
    };
  }, [video]);
  return (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      title={t("camera.title")}
      actions={
        <Button variant="text" onClick={onClose}>
          {t("camera.close")}
        </Button>
      }
    >
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Typography variant="body2" color="text.secondary">
          {t("camera.hint")}
        </Typography>
        {failed ? <Alert severity="error">{t("camera.error")}</Alert> : null}
        <Box
          sx={{
            position: "relative",
            flex: 1,
            minHeight: 240,
            bgcolor: "grey.900",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <Box
            component="video"
            ref={setVideo}
            {...VIDEO_PROPS}
            aria-label={t("camera.videoAria")}
            sx={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              left: "10%",
              right: "10%",
              top: "35%",
              bottom: "35%",
              border: 2,
              borderColor: "primary.main",
              borderRadius: 1,
            }}
          />
        </Box>
        {lastCode === null ? null : (
          <Typography variant="body2">
            {t("camera.lastRead", { code: lastCode })}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
};
