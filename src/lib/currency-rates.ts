// Tassi statici e approssimativi — non live. Sufficienti per aggregare
// il valore di un guardaroba personale su poche valute, non per usi
// dove serve precisione esatta.
// Tassi al 2026-08-12 (mid-market, fonte: xe.com), base = EUR.
export const RATES_AS_OF = "2026-08-12";
const EUR_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.1536,
  GBP: 0.8541,
};

/** Converte un importo da una valuta all'altra usando la tabella sopra.
 *  Per valute non note ricade su 1:1 invece di lanciare un errore —
 *  meglio un numero approssimativo onesto che un crash. */
export function convertCurrency(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const fromRate = EUR_RATES[from] ?? 1;
  const toRate = EUR_RATES[to] ?? 1;
  const amountInEur = amount / fromRate;
  return amountInEur * toRate;
}
