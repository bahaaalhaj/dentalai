// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingInvoice } from '@dentalai/contracts';
import { PaymentDialog } from '../billing/PaymentDialog';
import { BillingPage } from '../billing/BillingPage';
import { inputMinor, showMoney } from '../billing/Money';
const mocks = vi.hoisted(() => ({ payment: vi.fn(), refund: vi.fn(), invoices: vi.fn() }));
vi.mock('../lib/api-client', () => ({
  apiClient: {
    recordPayment: mocks.payment,
    recordRefund: mocks.refund,
    billingInvoices: mocks.invoices,
  },
}));
const invoice: BillingInvoice = {
  id: crypto.randomUUID(),
  patientId: crypto.randomUUID(),
  invoiceNumber: 'INV-FICTIONAL',
  currency: 'USD',
  status: 'issued',
  version: 2,
  issuedAt: new Date().toISOString(),
  originalTotalMinor: 10000,
  adjustedTotalMinor: 10000,
  paymentsMinor: 0,
  refundsMinor: 0,
  balanceMinor: 10000,
  items: [],
  events: [],
};
// jsdom lacks native dialog methods; browser E2E covers the actual modal implementation.
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
  configurable: true,
  value() {
    this.setAttribute('open', '');
  },
});
Object.defineProperty(HTMLDialogElement.prototype, 'close', {
  configurable: true,
  value() {
    this.removeAttribute('open');
  },
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('production billing UI', () => {
  it('retains exact cents in large report formatting and negative sub-unit adjustments', () => {
    expect(showMoney(Number.MAX_SAFE_INTEGER, 'USD')).toContain('.91');
    expect(showMoney(-1, 'USD')).toContain('-$0.01');
    expect(inputMinor('1.0001', 'CLF')).toBe(10001);
  });
  it('converts currency input exactly, rejecting malformed or excessive precision', () => {
    expect(inputMinor('0.29', 'USD')).toBe(29);
    expect(inputMinor('1.001', 'KWD')).toBe(1001);
    expect(inputMinor('100', 'JPY')).toBe(100);
    for (const input of ['0.001', '-1', '1e2', 'Infinity', 'NaN', ' 1'])
      expect(() => inputMinor(input, 'USD')).toThrow();
  });
  it('rejects zero before sending, keeps fields editable, then records a receipt', async () => {
    const saved = vi.fn().mockResolvedValue(undefined);
    mocks.payment.mockResolvedValue({ invoice, receiptReference: 'REC-FICTIONAL' });
    render(<PaymentDialog invoice={invoice} action="payment" saved={saved} close={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Amount in USD'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Financial change reason'), {
      target: { value: 'Fictional reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm financial action' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('positive amount');
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Amount in USD')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Amount in USD'), { target: { value: '0.29' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm financial action' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('REC-FICTIONAL'));
    expect(mocks.payment.mock.calls[0]![1].amountMinor).toBe(29);
  });
  it('retries ambiguous failures with identical details and idempotency key', async () => {
    mocks.payment
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValue({ invoice, receiptReference: 'REC-FICTIONAL' });
    render(
      <PaymentDialog
        invoice={invoice}
        action="payment"
        saved={vi.fn().mockResolvedValue(undefined)}
        close={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Amount in USD'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Financial change reason'), {
      target: { value: 'Fictional reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm financial action' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Amount in USD')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same financial action' }));
    await waitFor(() => expect(mocks.payment).toHaveBeenCalledTimes(2));
    expect(mocks.payment.mock.calls[1]).toEqual(mocks.payment.mock.calls[0]);
  });
  it('does not lock a malformed refund before it reaches the server', async () => {
    render(<PaymentDialog invoice={invoice} action="refund" saved={vi.fn()} close={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Amount in USD'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Financial change reason'), {
      target: { value: 'Fictional reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm financial action' }));
    await screen.findByRole('alert');
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Original payment')).not.toBeDisabled();
  });
  it('renders patient invoices read-only without mutation controls', async () => {
    mocks.invoices.mockResolvedValue([invoice]);
    render(
      <MemoryRouter>
        <BillingPage portal />
      </MemoryRouter>,
    );
    await screen.findByRole('option', { name: /INV-FICTIONAL/ });
    fireEvent.change(screen.getByLabelText('Invoice', { exact: true }), {
      target: { value: invoice.id },
    });
    expect(screen.getByRole('heading', { name: /INV-FICTIONAL/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
  });
  it('shows a recoverable portal error and retry instead of invented financial data', async () => {
    mocks.invoices.mockRejectedValueOnce(new Error('Billing unavailable')).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <BillingPage portal />
      </MemoryRouter>,
    );
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No issued invoices available.');
    expect(mocks.invoices).toHaveBeenCalledTimes(2);
  });
});
