import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  STOCKTAKE_CONFIRM_FORM_KEY,
  STORE_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import { useLotteryStocktakeStatusQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

export interface StocktakeEntry {
  /** 頂部 [盤點](沒有 `store.stocktake` = null) */
  button: ReactNode;
  /** 距離上次盤點超過 24 小時的提醒 */
  reminder: ReactNode;
  /** 盤點範圍視窗 */
  element: ReactNode;
}

/**
 * 看板的盤點入口(規格 6.1、6.2、6.8;Figma ST-01、ST-16):頂部 [盤點](`store.stocktake`)→ 選範圍
 * (全店 / 單一收銀點)→ 盤點頁(盤點確認申請的新增頁,`?org=` `?scope=`);距離上次盤點超過 24 小時提醒「建議盤點一次」。
 */
export const useStocktakeEntry = (
  orgId: string,
  cashPoints: readonly { id: string; name: string }[],
): StocktakeEntry => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(STORE_KEY);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"store" | "cashPoint">("store");
  const [cashPointId, setCashPointId] = useState("");
  const status = useLotteryStocktakeStatusQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const canStocktake =
    hasPermission(STORE_PERMISSIONS.stocktake) && access.createRoute !== null;
  const remind = status.data?.lotteryStocktakeStatus.remind === true;
  const start = () => {
    const params = new URLSearchParams({ org: orgId });
    if (mode === "cashPoint" && cashPointId !== "") {
      params.set("scope", cashPointId);
    }
    setOpen(false);
    void navigate(
      `${access.createRoute ?? ""}/${STOCKTAKE_CONFIRM_FORM_KEY}?${params.toString()}`,
    );
  };
  return {
    button: canStocktake ? (
      <Button
        variant="outlined"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("entry.button")}
      </Button>
    ) : null,
    reminder: remind ? (
      <Alert severity="warning">{t("entry.reminder")}</Alert>
    ) : null,
    element: (
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        fullWidth
        maxWidth="xs"
        title={t("scope.title")}
        actions={
          <>
            <Button
              variant="text"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("scope.cancel")}
            </Button>
            <Button
              variant="contained"
              disabled={mode === "cashPoint" && cashPointId === ""}
              onClick={start}
            >
              {t("scope.start")}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <RadioGroup
            aria-label={t("scope.title")}
            value={mode}
            onChange={(event) => {
              setMode(
                event.target.value === "cashPoint" ? "cashPoint" : "store",
              );
            }}
          >
            <FormControlLabel
              value="store"
              control={<Radio />}
              label={t("scope.store")}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <FormControlLabel
                value="cashPoint"
                control={<Radio />}
                label={t("scope.cashPoint")}
              />
              <SelectField
                label={t("scope.cashPointLabel")}
                size="small"
                value={cashPointId}
                disabled={mode !== "cashPoint"}
                options={cashPoints.map((point) => ({
                  value: point.id,
                  label: point.name,
                }))}
                onChange={(next: string) => {
                  setCashPointId(next);
                }}
                sx={{ minWidth: 160 }}
              />
            </Stack>
          </RadioGroup>
          <Typography variant="body2" color="text.secondary">
            {t("scope.hint")}
          </Typography>
        </Stack>
      </Dialog>
    ),
  };
};
