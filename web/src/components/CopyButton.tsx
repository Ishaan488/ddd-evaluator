import { useState } from 'react';
import { Icon } from './Icons';

/** Copies a value (a hash, an id) to the clipboard and says so. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: nothing else to do */
    }
  };
  return (
    <button type="button" className={`copy ${copied ? 'copy-done' : ''}`} onClick={copy} aria-label={`${label} ${value.slice(0, 12)}`}>
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Copied' : label}
    </button>
  );
}
