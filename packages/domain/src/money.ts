/** Integer arithmetic only. Scale is explicit; decimal conversion rejects excess precision. */
export const MAX_MONEY_MINOR = 1_000_000_000_000;
export function parseMoney(value: string, scale: number): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 4 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error('Enter a non-negative decimal amount without exponent notation.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > scale)
    throw new Error('Amount has more precision than its currency allows.');
  return boundedMinor(
    BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0'),
  );
}
export function boundedMinor(value: bigint): number {
  if (value < -BigInt(MAX_MONEY_MINOR) || value > BigInt(MAX_MONEY_MINOR))
    throw new Error('Money limit exceeded.');
  return Number(value);
}
/** Positive quantity in hundredths, round half-up once at the line boundary. */
export function lineAmount(
  unitMinor: number,
  quantityHundredths: number,
  discountMinor: number,
  taxMinor: number,
): number {
  if (
    ![unitMinor, quantityHundredths, discountMinor, taxMinor].every(Number.isSafeInteger) ||
    unitMinor < 0 ||
    quantityHundredths <= 0 ||
    discountMinor < 0 ||
    taxMinor < 0
  )
    throw new Error('Invalid line amounts.');
  const gross = (BigInt(unitMinor) * BigInt(quantityHundredths) + 50n) / 100n;
  if (BigInt(discountMinor) > gross) throw new Error('Discount exceeds the line amount.');
  return boundedMinor(gross - BigInt(discountMinor) + BigInt(taxMinor));
}
export function sumMinor(values: readonly number[]): number {
  if (!values.every(Number.isSafeInteger)) throw new Error('Invalid minor amount.');
  return boundedMinor(values.reduce((sum, value) => sum + BigInt(value), 0n));
}
