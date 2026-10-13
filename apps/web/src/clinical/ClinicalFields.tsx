import type { ReactNode } from 'react';

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm text-slate-700">
      {label}
      <input
        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 focus:ring-2 focus:ring-indigo-500"
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  values,
  placeholder,
  displayValue,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  values: readonly string[];
  placeholder?: string;
  displayValue?: (value: string) => string;
}) {
  return (
    <label className="block text-sm text-slate-700">
      {label}
      <select
        aria-label={label}
        className="mt-1 w-full rounded-xl border border-slate-200 p-3"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {values.map((v) => (
          <option key={v} value={v}>
            {displayValue ? displayValue(v) : v.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}
