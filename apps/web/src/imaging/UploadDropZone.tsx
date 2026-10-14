import { useState } from 'react';
import { UploadCloud, FileImage } from 'lucide-react';
import { t } from '../i18n';
export function UploadDropZone({
  file,
  busy,
  choose,
  reject,
}: {
  file: File | undefined;
  busy: boolean;
  choose: (file: File | undefined) => void;
  reject: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const select = (candidate: File | undefined) => {
    if (
      candidate &&
      (!['image/png', 'image/jpeg'].includes(candidate.type) ||
        candidate.size > 10 * 1024 * 1024 ||
        candidate.size === 0)
    ) {
      choose(undefined);
      reject();
      return;
    }
    choose(candidate);
  };
  return (
    <div
      className="ui-upload-zone"
      data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy) select(event.dataTransfer.files[0]);
      }}
    >
      <UploadCloud size={30} aria-hidden="true" />
      <h2>{t('polish.uploadTitle')}</h2>
      <p>{t('polish.dropFile')}</p>
      <p className="ui-caption">{t('polish.uploadHint')}</p>
      <label className="block mt-3">
        {t('ui.9eefe33e02c935dd')}
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => select(event.target.files?.[0])}
          disabled={busy}
          className="block py-3"
        />
      </label>
      {file && (
        <p className="flex items-center gap-2">
          <FileImage size={18} aria-hidden="true" />
          <bdi>{file.name}</bdi>
          <span>
            {(file.size / 1024).toFixed(1)} {t('ui.97ee1b8dd0d5456b')}
          </span>
        </p>
      )}
      <p className="ui-caption mt-2">{t('polish.previewAfterUpload')}</p>
    </div>
  );
}
