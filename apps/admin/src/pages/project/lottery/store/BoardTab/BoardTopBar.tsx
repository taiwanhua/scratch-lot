import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useRealtimeStatus } from "@/hooks/base/useRealtime";

export interface BoardTopBarProps {
  orgId: string;
  onOrgChange: (orgId: string) => void;
  cashPoints: readonly { id: string; name: string }[];
  /** 本機收銀點;沒設定 = null */
  localId: string | null;
  onLocalChange: (cashPointId: string) => void;
  /** 操作者在這家店開著的班的收銀點名稱(兩個以上才顯示「你開著的班」) */
  myShiftNames: readonly string[];
}

/**
 * 看板頂部(規格 6.1;Figma ST-01、ST-34a):分店選擇器(`OrgTreeSelect scope="visible"`)、本機收銀點、
 * 「你開著的班」、連線狀態小圓點(綠 = 即時;黃 = 重新連線中、每 60 秒更新);沒有重新整理按鈕。
 */
export const BoardTopBar = ({
  orgId,
  onOrgChange,
  cashPoints,
  localId,
  onLocalChange,
  myShiftNames,
}: BoardTopBarProps) => {
  const t = useTranslations("admin.lotteryStore.top");
  const status = useRealtimeStatus();
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}
    >
      <Box sx={{ width: { xs: "100%", sm: 200 } }}>
        <OrgTreeSelect
          scope="visible"
          label={t("org")}
          value={orgId === "" ? [] : [orgId]}
          size="small"
          fullWidth
          onChange={(ids) => {
            onOrgChange(ids.at(0) ?? "");
          }}
        />
      </Box>
      <Box sx={{ width: { xs: "100%", sm: 180 } }}>
        <SelectField
          label={t("localCashPoint")}
          value={localId ?? ""}
          size="small"
          fullWidth
          displayEmpty
          options={[
            { value: "", label: t("notSet") },
            ...cashPoints.map((point) => ({
              value: point.id,
              label: point.name,
            })),
          ]}
          onChange={(value: string) => {
            if (value !== "") {
              onLocalChange(value);
            }
          }}
        />
      </Box>
      {myShiftNames.length >= 2 ? (
        <Typography variant="body2" sx={{ color: "warning.dark" }}>
          {t("myShifts", { names: myShiftNames.join(" · ") })}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: status === "live" ? "success.main" : "warning.main",
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {status === "live" ? t("live") : t("reconnecting")}
        </Typography>
      </Stack>
    </Stack>
  );
};
