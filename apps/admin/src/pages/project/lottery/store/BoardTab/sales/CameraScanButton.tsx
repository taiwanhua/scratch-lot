import { useEffect, useState } from "react";

import { Button } from "@repo/ui/button";

import { detectCamera } from "./camera-reader";
import { useSalesText } from "./useSalesText";

/**
 * 看板頂部的 [📷 掃描](規格 6.3、18.3):只在有相機的手機與平板顯示;按了打開全螢幕相機框。
 */
export const CameraScanButton = ({ onOpen }: { onOpen: () => void }) => {
  const { t } = useSalesText();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void detectCamera().then((has) => {
      if (alive) {
        setAvailable(has);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!available) {
    return null;
  }
  return (
    <Button size="small" variant="outlined" onClick={onOpen}>
      {t("camera.button")}
    </Button>
  );
};
