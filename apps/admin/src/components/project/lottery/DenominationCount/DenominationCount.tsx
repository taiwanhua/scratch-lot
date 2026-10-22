import { Box } from "@repo/ui/box";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

export interface DenominationRow {
  value: number;
  count: number;
}

export interface DenominationCountLabels {
  value: string;
  count: string;
  subtotal: string;
  total: string;
  /** 每一列輸入框的無障礙名稱(面額帶入) */
  countAria: (value: number) => string;
}

export interface DenominationCountProps {
  /** 面額表(由大到小)與目前的張數 */
  rows: readonly DenominationRow[];
  /** 改某個面額的張數;不給 = 唯讀(檢視頁) */
  onChange?: (value: number, count: number) => void;
  /** 文字一律由使用處傳入(I18N-01) */
  labels: DenominationCountLabels;
  /** 金額的顯示(千分位) */
  moneyText: (value: number) => string;
}

/**
 * 依面額清點(Figma `Draft/DenominationCount` 64:366;交班精靈第 ③ 步、結帳確認申請檢視頁、日結共用):
 * 面額 / 張 · 枚 / 小計,底部實點合計。唯讀時張數只顯示數字。
 */
export const DenominationCount = ({
  rows,
  onChange,
  labels,
  moneyText,
}: DenominationCountProps) => {
  const total = rows.reduce((sum, row) => sum + row.value * row.count, 0);
  const cell = (text: string, align: "left" | "right" = "left") => (
    <Typography variant="body2" color="textSecondary" sx={{ textAlign: align }}>
      {text}
    </Typography>
  );
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(56px, 1fr) minmax(96px, 1.2fr) 1fr",
        columnGap: 2,
        rowGap: 1,
        alignItems: "center",
      }}
    >
      {cell(labels.value)}
      {cell(labels.count)}
      {cell(labels.subtotal, "right")}
      {rows.map((row) => (
        <Box key={row.value} sx={{ display: "contents" }}>
          <Typography variant="body1">{moneyText(row.value)}</Typography>
          {onChange === undefined ? (
            <Typography variant="body1">{row.count}</Typography>
          ) : (
            <TextField
              size="small"
              type="number"
              value={row.count === 0 ? "" : String(row.count)}
              slotProps={{
                htmlInput: {
                  min: 0,
                  step: 1,
                  inputMode: "numeric",
                  "aria-label": labels.countAria(row.value),
                },
              }}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                onChange(
                  row.value,
                  Number.isInteger(next) && next > 0 ? next : 0,
                );
              }}
              sx={{ maxWidth: 140 }}
            />
          )}
          <Typography variant="body1" sx={{ textAlign: "right" }}>
            {moneyText(row.value * row.count)}
          </Typography>
        </Box>
      ))}
      <Typography
        variant="subtitle2"
        color="textSecondary"
        sx={{
          gridColumn: "1 / 3",
          borderTop: 1,
          borderColor: "divider",
          pt: 1,
        }}
      >
        {labels.total}
      </Typography>
      <Typography
        variant="subtitle1"
        sx={{ textAlign: "right", borderTop: 1, borderColor: "divider", pt: 1 }}
      >
        {moneyText(total)}
      </Typography>
    </Box>
  );
};
