import { describe, expect, it } from 'vitest';
import { lineAmount, parseMoney, sumMinor } from '@dentalai/domain';
import {
  PaymentWriteSchema,
  AdjustmentWriteSchema,
  createOpenApiDocument,
} from '@dentalai/contracts';
describe('production money rules and contracts', () => {
  it('converts decimal strings without floating point and honors explicit precision', () => {
    expect(parseMoney('12.34', 2)).toBe(1234);
    expect(parseMoney('1.001', 3)).toBe(1001);
    expect(parseMoney('1.0001', 4)).toBe(10001);
    expect(parseMoney('500', 0)).toBe(500);
    for (const v of ['1.001', '1e2', 'NaN', 'Infinity', '-1', '', ' 1', '01'])
      expect(() => parseMoney(v, 2)).toThrow();
  });
  it('rounds half-up at the line boundary and reconciles discounts and taxes', () => {
    expect(lineAmount(101, 50, 0, 0)).toBe(51);
    expect(lineAmount(101, 150, 1, 2)).toBe(153);
    expect(sumMinor([51, 153])).toBe(204);
    expect(() => lineAmount(100, 100, 101, 0)).toThrow();
    expect(() => sumMinor([1, Number.NaN])).toThrow();
    expect(() => lineAmount(100, 0, 0, 0)).toThrow();
  });
  it.each([0, -1, Infinity, NaN, 1.5, '1', '1e3', null])(
    'rejects malformed payment %s',
    (amount) => {
      expect(
        PaymentWriteSchema.safeParse({
          amountMinor: amount,
          currency: 'USD',
          method: 'cash',
          externalReference: null,
          reason: 'Fictional',
          requestKey: crypto.randomUUID(),
        }).success,
      ).toBe(false);
    },
  );
  it('requires explicit adjustment workflow and rejects browser-owned fields', () => {
    const body = {
      amountMinor: -1,
      currency: 'USD',
      reason: 'Fictional',
      requestKey: crypto.randomUUID(),
    };
    expect(AdjustmentWriteSchema.safeParse(body).success).toBe(true);
    expect(AdjustmentWriteSchema.safeParse({ ...body, amountMinor: 0 }).success).toBe(false);
    expect(
      PaymentWriteSchema.safeParse({
        ...body,
        amountMinor: 1,
        method: 'cash',
        externalReference: null,
        clinicId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('documents actual billing contracts', () => {
    expect(createOpenApiDocument().paths).toHaveProperty('/api/v1/billing/invoices/{id}/refunds');
  });
});
