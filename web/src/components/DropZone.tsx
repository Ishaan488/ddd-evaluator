import { useRef, useState } from 'react';
import { Icon, type IconName } from './Icons';

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DropZone({
  label,
  hint,
  accept,
  file,
  onFile,
  icon,
  error,
}: {
  label: string;
  hint: string;
  accept: string[];
  file: File | null;
  onFile: (file: File | null) => void;
  icon: IconName;
  error?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const next = list?.[0];
    if (next) onFile(next);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div
        className={`drop ${over ? 'drop-over' : ''} ${file ? 'drop-filled' : ''} ${error ? 'drop-error' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        <input ref={input} type="file" accept={accept.join(',')} hidden onChange={(e) => take(e.target.files)} />
        {file ? (
          <div className="drop-file">
            <span className="drop-icon">
              <Icon name="file" size={20} />
            </span>
            <div className="drop-meta">
              <span className="drop-name">{file.name}</span>
              <span className="drop-size">{size(file.size)}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFile(null)} aria-label={`Remove ${file.name}`}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : (
          <button type="button" className="drop-empty" onClick={() => input.current?.click()}>
            <span className="drop-icon">
              <Icon name={icon} size={20} />
            </span>
            <span className="drop-title">Drop a file here, or <u>browse</u></span>
            <span className="drop-hint">{hint}</span>
          </button>
        )}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
