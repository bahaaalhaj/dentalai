import { useEffect, useRef, useId, type ReactNode } from 'react';
import { uiMessages } from './messages';
export function ActionDialog({
  title,
  children,
  onClose,
  busy = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        // StrictMode cleanup closes and immediately reopens the dialog. The native
        // queued close event must not dismiss a dialog that is open again.
        if (dialog.current && !dialog.current.open) onClose();
      }}
      className={`w-full max-w-xl p-6 rounded-3xl border border-slate-200 shadow-xl backdrop:bg-slate-900/40 ${className}`}
    >
      <div className="flex justify-between gap-4 mb-5">
        <h2 id={titleId} className="font-bold text-xl text-slate-900">
          {title}
        </h2>
        <button
          type="button"
          disabled={busy}
          aria-label={uiMessages().close}
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
