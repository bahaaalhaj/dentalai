import { t } from '../i18n';
import { parseMoney } from '@dentalai/domain';
export function currencyScale(currency: string) {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}
export function inputMinor(value: string, currency: string) {
  return parseMoney(value, currencyScale(currency));
}
export function showMoney(minor: number, currency: string) {
  if (!Number.isSafeInteger(minor)) throw new Error(t('ui.e413c69bcdf24003'));
  const scale = currencyScale(currency),
    factor = 10n ** BigInt(scale);
  const amount = BigInt(minor),
    magnitude = amount < 0n ? -amount : amount;
  const whole = magnitude / factor;
  const fraction = (magnitude % factor).toString().padStart(scale, '0');
  // Format the whole part as BigInt, then inject exact minor digits; even large reports retain cents.
  return new Intl.NumberFormat(undefined, { style: 'currency', currency })
    .formatToParts(minor < 0 ? (whole === 0n ? -0 : -whole) : whole)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}
