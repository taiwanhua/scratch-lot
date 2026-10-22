/**
 * 58mm 單據的列印幾何(點 = CSS px,1:1):單據寬 384 點 = 收據機可列印寬約 48mm(203 dpi)。
 *
 * 這些值不走 theme(STYLE-06 的例外):它們是紙張與印字頭的物理尺寸,不是品牌樣式;
 * 深色模式、裝置寬度都不能改變它們 —— 電腦 / 平板 / 手機的預覽都顯示同寬的單據。
 *
 * 字級:Figma `Draft/Receipt58*`內文 14px,但那樣一行約 25 個中文字;
 * 58mm 單據的版面要「一行約 16 個中文字」:可用寬 352 ÷ 16 = 22 點。
 * 因此字級以內文 22 點為準,其他字級依 Figma 的比例(× 22/14)放大取整。
 */
export const RECEIPT58_DOTS = 384;

/** 左右邊界(Figma:寬 352 = 384 扣左右各 16)。 */
export const RECEIPT58_PADDING_X = 16;

/** 上下邊界(Figma py 20)。 */
export const RECEIPT58_PADDING_Y = 20;

/** 可用寬度。 */
export const RECEIPT58_CONTENT_WIDTH = RECEIPT58_DOTS - RECEIPT58_PADDING_X * 2;

/** 一般字一行容納的中文字數(約 16 個)。 */
export const RECEIPT58_CJK_PER_LINE = 16;

/** 字級(點)與行高;Figma 對照:large 17/26、normal 14/22、small 12/18、title 16/24。 */
export const RECEIPT58_FONT = {
  large: { size: 28, lineHeight: 36 },
  normal: { size: 22, lineHeight: 30 },
  small: { size: 18, lineHeight: 26 },
  title: { size: 26, lineHeight: 34 },
} as const;

export type Receipt58FontSize = keyof typeof RECEIPT58_FONT;

/** 表格第 2、3 欄寬(Figma 56 / 80,× 22/14 取整)。 */
export const RECEIPT58_TABLE_COL_WIDTHS = [88, 126] as const;

/** 線寬:Figma 1px,放大後取 2 點,熱感紙上才看得清楚。 */
export const RECEIPT58_STROKE = 2;

/** QR 規範要求的四個模組安靜區(白邊;紙張本身是白底,只留位置不畫)。 */
export const RECEIPT58_QR_QUIET_ZONE = 4;

/** 零件之間的間距(Figma gap 6)。 */
export const RECEIPT58_GAP = 8;

/** 熱感紙只有黑:字、線一律 common.black(不隨深色模式改變,STYLE-04 的 palette 管道)。 */
export const RECEIPT58_INK = "common.black";

/**
 * 「標籤 + 值」兩欄列的標籤欄:內容短時照內容寬,太長時最多佔一半寬並換行,
 * 值欄(`flex: 1`)永遠留得到另一半,兩邊都不截斷。
 */
export const RECEIPT58_LABEL_SX = {
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: "50%",
} as const;

/** 點數 → CSS 長度字串(sx 的數字會被當成 spacing 倍數,列印幾何一律寫成 px 字串)。 */
export const dots = (value: number): string => `${String(value)}px`;

/** 一段文字的共用樣式:可換行、不截斷(長字串、網址也會在任意處折行)。 */
export const receiptTextSx = (font: Receipt58FontSize, isBold = false) =>
  ({
    m: 0,
    color: RECEIPT58_INK,
    fontSize: dots(RECEIPT58_FONT[font].size),
    lineHeight: dots(RECEIPT58_FONT[font].lineHeight),
    fontWeight: isBold ? 600 : 400,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "normal",
  }) as const;
