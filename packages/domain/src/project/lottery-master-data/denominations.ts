/**
 * 面額與整本張數的對照表(專案規格 5.1):**只有這一份**,api 判斷非標準組合、admin 帶入張數都讀這裡。
 * 選預設面額自動帶入張數;張數可改,非標準組合只提示、不擋。
 */
export const STANDARD_DENOMINATIONS = [
  { unitPrice: 100, ticketsPerBook: 100 },
  { unitPrice: 200, ticketsPerBook: 100 },
  { unitPrice: 300, ticketsPerBook: 100 },
  { unitPrice: 500, ticketsPerBook: 50 },
  { unitPrice: 1000, ticketsPerBook: 25 },
  { unitPrice: 2000, ticketsPerBook: 18 },
] as const;

/** 預設面額(下拉的選項順序)。 */
export const STANDARD_UNIT_PRICES: readonly number[] =
  STANDARD_DENOMINATIONS.map((denomination) => denomination.unitPrice);

/** 預設面額對應的整本張數;不是預設面額 → null(不帶入)。 */
export function standardTicketsPerBook(unitPrice: number): number | null {
  return (
    STANDARD_DENOMINATIONS.find(
      (denomination) => denomination.unitPrice === unitPrice,
    )?.ticketsPerBook ?? null
  );
}

/** 面額與張數是不是對照表裡的一組(否則畫面只提示「非標準組合」)。 */
export function isStandardCombination(
  unitPrice: number,
  ticketsPerBook: number,
): boolean {
  return standardTicketsPerBook(unitPrice) === ticketsPerBook;
}
