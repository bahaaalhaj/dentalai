// @vitest-environment jsdom
import { StrictMode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ActionDialog } from '@dentalai/ui';

it('ignores queued cleanup close events after StrictMode reopens, but handles explicit close', async () => {
  const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      queueMicrotask(() => this.dispatchEvent(new Event('close')));
    },
  });
  const onClose = vi.fn();
  try {
    render(
      <StrictMode>
        <ActionDialog title="Synthetic dialog" onClose={onClose}>
          Content
        </ActionDialog>
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog', { name: 'Synthetic dialog' })).toHaveAttribute('open');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  }
});
