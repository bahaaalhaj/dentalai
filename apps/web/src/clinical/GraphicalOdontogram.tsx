import { useId, useRef, useState } from 'react';
import type { ClinicalContent, ClinicalRecord } from '@dentalai/contracts';
import { t } from '../i18n';
import { displayStatus } from '../i18n/display';
import { ToothGlyph } from './ToothGlyph';
import { StatusBadge } from '../ui/StatusBadge';
import './odontogram.css';

type ChartRecord = { data: ClinicalContent; approval?: ClinicalRecord['approval'] };
const rows = [
  ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
  ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'],
  ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'],
  ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'],
];
const codes = [
  'healthy',
  'caries',
  'restoration',
  'root_canal',
  'crown',
  'implant',
  'missing',
  'extraction',
  'fracture',
  'periapical_lesion',
];
/** Display supplied records only. This component never infers or persists clinical truth. */
function toothRecords(records: ChartRecord[], tooth: string) {
  return records.filter(
    (record) =>
      (record.data.kind === 'finding' || record.data.kind === 'procedure') &&
      record.data.toothCode === tooth &&
      record.data.status !== 'entered_in_error',
  );
}
export function Odontogram({
  records,
  select,
  approvedProjection = false,
}: {
  records: ChartRecord[];
  select?: (tooth: string) => void;
  approvedProjection?: boolean;
}) {
  const [selected, setSelected] = useState(''),
    [focused, setFocused] = useState('18');
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const prefix = useId();
  const selectedRecords = toothRecords(records, selected);
  return (
    <section className="ui-card odontogram" aria-label={t('ui.d27a92a5853e6770')}>
      <div className="ui-card-heading">
        <h2>{t('ui.16afbf9956d84ea5')}</h2>
        {!select && <StatusBadge value="read_only" />}
      </div>
      <p className="ui-caption">{t('ui.807d7b25f46bfb23')}</p>
      <p className="ui-caption mt-2">{t('polish.chartHelp')}</p>
      <div className="odontogram-scroll" tabIndex={0} aria-label={t('polish.chart')}>
        <div className="odontogram-arches" dir="ltr">
          <div className="odontogram-orientation">
            <span>{t('polish.patientRight')}</span>
            <span>{t('polish.patientLeft')}</span>
          </div>
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="odontogram-row-group">
              {rowIndex % 2 === 0 && (
                <h3 className="ui-caption text-center mb-3">
                  {t(rowIndex === 0 ? 'polish.permanent' : 'polish.primary')}
                </h3>
              )}
              <div className="odontogram-row">
                {row.map((tooth, index) => {
                  const entries = toothRecords(records, tooth);
                  const pending = entries.some(
                    (entry) => !approvedProjection && entry.approval !== 'approved',
                  );
                  const markers = entries.flatMap((entry) => {
                    const reviewed = approvedProjection || entry.approval === 'approved';
                    if (!reviewed) return [];
                    if (entry.data.kind === 'finding' && entry.data.status === 'active')
                      return [entry.data.findingCode];
                    if (entry.data.kind === 'procedure' && entry.data.status === 'completed')
                      return [entry.data.procedureCode];
                    return [];
                  });
                  const descriptions = entries.map((entry) =>
                    entry.data.kind === 'finding'
                      ? `${entry.data.status === 'resolved' ? 'resolved ' : ''}${entry.data.findingCode}`
                      : entry.data.kind === 'procedure'
                        ? `${entry.data.procedureCode} (${displayStatus(entry.data.status)})`
                        : '',
                  );
                  const state = descriptions.length
                    ? descriptions.join(', ')
                    : t('polish.unrecorded');
                  return (
                    <button
                      className="tooth-button"
                      key={tooth}
                      type="button"
                      data-state={!entries.length ? 'unknown' : pending ? 'pending' : 'recorded'}
                      data-selected={selected === tooth}
                      aria-pressed={selected === tooth}
                      aria-label={t('polish.tooth', { code: tooth, state })}
                      aria-describedby={`${prefix}-state-${tooth}`}
                      tabIndex={focused === tooth ? 0 : -1}
                      ref={(node) => {
                        if (node) refs.current.set(tooth, node);
                        else refs.current.delete(tooth);
                      }}
                      onFocus={() => setFocused(tooth)}
                      onClick={() => {
                        setSelected(tooth);
                        select?.(tooth);
                      }}
                      onKeyDown={(event) => {
                        let target: string | undefined;
                        if (event.key === 'ArrowRight')
                          target = row[Math.min(row.length - 1, index + 1)];
                        if (event.key === 'ArrowLeft') target = row[Math.max(0, index - 1)];
                        if (event.key === 'Home') target = row[0];
                        if (event.key === 'End') target = row[row.length - 1];
                        if (event.key === 'ArrowUp') {
                          const other = rows[Math.max(0, rowIndex - 1)]!;
                          target = other[Math.min(other.length - 1, index)];
                        }
                        if (event.key === 'ArrowDown') {
                          const other = rows[Math.min(rows.length - 1, rowIndex + 1)]!;
                          target = other[Math.min(other.length - 1, index)];
                        }
                        if (target) {
                          event.preventDefault();
                          refs.current.get(target)?.focus();
                        }
                      }}
                    >
                      <span className="tooth-number">{tooth}</span>
                      <ToothGlyph
                        code={tooth}
                        pending={pending}
                        unknown={!entries.length}
                        codes={markers}
                      />
                      <span className="sr-only" id={`${prefix}-state-${tooth}`}>
                        {!entries.length
                          ? t('polish.unrecorded')
                          : pending
                            ? t('polish.unreviewed')
                            : t('polish.recorded')}
                      </span>
                      <span className="tooth-marker" aria-hidden="true">
                        {!entries.length ? '·' : pending ? '◷' : '◆'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="odontogram-legend" aria-label={t('polish.legend')}>
        <span>
          <i className="legend-unknown" aria-hidden="true" />
          {t('polish.unrecorded')}
        </span>
        <span>
          <i className="legend-pending" aria-hidden="true" />
          {t('polish.unreviewed')}
        </span>
        {codes.map((code) => (
          <span key={code}>
            <span className="legend-glyph">
              <ToothGlyph code="16" pending={false} unknown={false} codes={[code]} />
            </span>
            <bdi>{code}</bdi>
          </span>
        ))}
      </div>
      <p className="ui-caption mt-3">{t('polish.clinicalCodes')}</p>
      {selected && (
        <div className="odontogram-selection" role="status">
          <h3>{t('polish.selectedTooth', { code: selected })}</h3>
          {!selectedRecords.length ? (
            <p className="ui-caption">{t('polish.noToothRecord')}</p>
          ) : (
            selectedRecords.map((record, index) => (
              <p key={index} className="flex flex-wrap items-center gap-2 mt-2">
                <bdi>
                  {record.data.kind === 'finding'
                    ? record.data.findingCode
                    : record.data.kind === 'procedure'
                      ? record.data.procedureCode
                      : ''}
                </bdi>
                {'status' in record.data && <bdi>{record.data.status}</bdi>}
                <StatusBadge
                  value={approvedProjection ? 'approved' : (record.approval ?? 'pending')}
                />
                {'surfaces' in record.data && <bdi>{record.data.surfaces.join(', ')}</bdi>}
              </p>
            ))
          )}
        </div>
      )}
    </section>
  );
}
