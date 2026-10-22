import { Icon } from './Icons';

/** A small (i) that explains a term in plain words, on hover or keyboard focus. */
export function Hint({ text, align = 'center' }: { text: string; align?: 'center' | 'left' | 'right' }) {
  return (
    <span className={`hint hint-${align}`} tabIndex={0} role="note" aria-label={text} data-tip={text}>
      <Icon name="info" size={14} />
    </span>
  );
}
