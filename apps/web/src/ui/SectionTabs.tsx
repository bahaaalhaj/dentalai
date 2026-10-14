import { useId, useRef, type ReactNode } from 'react';
import { useLocale } from '../i18n';
export function SectionTabs<T extends string>({
  tabs,
  active,
  change,
  label,
  children,
}: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  change: (id: T) => void;
  label: string;
  children: ReactNode;
}) {
  const prefix = useId(),
    refs = useRef<(HTMLButtonElement | null)[]>([]),
    locale = useLocale();
  return (
    <div className="ui-tab-layout">
      <div role="tablist" aria-label={label} className="ui-tabs">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${prefix}-${tab.id}`}
            aria-controls={`${prefix}-panel`}
            aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            ref={(node) => {
              refs.current[index] = node;
            }}
            onClick={() => change(tab.id)}
            onKeyDown={(event) => {
              const forward = locale === 'ar' ? 'ArrowLeft' : 'ArrowRight';
              const backward = locale === 'ar' ? 'ArrowRight' : 'ArrowLeft';
              const next =
                event.key === forward
                  ? (index + 1) % tabs.length
                  : event.key === backward
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                change(tabs[next]!.id);
                refs.current[next]?.focus();
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section
        id={`${prefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${prefix}-${active}`}
        tabIndex={0}
        className="ui-tab-panel"
      >
        {children}
      </section>
    </div>
  );
}
