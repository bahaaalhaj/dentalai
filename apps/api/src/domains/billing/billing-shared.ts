import { z } from 'zod';
import {
  type DraftReplaceSchema,
  type InvoiceActionSchema,
  type PaymentWriteSchema,
  type RefundWriteSchema,
  type AdjustmentWriteSchema,
} from '@dentalai/contracts';
import { boundedMinor } from '@dentalai/domain';
import { DomainError } from '../../errors/domain-errors.js';
export type Access = {
  clinicId: string;
  membershipId: string;
  manage: boolean;
  write: boolean;
  patient: boolean;
};
export type InvoiceRow = {
  id: string;
  patient_id: string;
  invoice_number: string;
  status: string;
  currency: string;
  total_minor: string;
  issued_at: Date | null;
  version: number;
  discarded_at: Date | null;
};
export type EventRow = {
  id: string;
  invoice_id: string;
  kind: string;
  amount_minor: string;
  currency: string;
  recorded_at: Date;
  receipt_reference: string | null;
  payment_id: string | null;
  refund_id: string | null;
  method: string | null;
  reason: string;
  operation_hash: string;
};
export type Operation =
  | z.infer<typeof InvoiceActionSchema>
  | z.infer<typeof PaymentWriteSchema>
  | z.infer<typeof RefundWriteSchema>
  | z.infer<typeof AdjustmentWriteSchema>
  | z.infer<typeof DraftReplaceSchema>;
export const denied = () => new DomainError('ACCESS_DENIED', 'Billing access denied.', 403);
export const missing = () =>
  new DomainError('NOT_FOUND', 'Invoice, patient or billing source not found.', 404);
export const conflict = (message = 'Billing changed. Refresh before retrying.') =>
  new DomainError('BILLING_CONFLICT', message, 409);
export const invalid = (message: string) => new DomainError('INVALID_BILLING', message, 422);
export const minor = (value: string) => boundedMinor(BigInt(value));
export const aggregate = (value: bigint) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount))
    throw new DomainError(
      'REPORT_LIMIT',
      'Financial aggregate exceeds the supported reporting limit.',
      503,
    );
  return amount;
};
