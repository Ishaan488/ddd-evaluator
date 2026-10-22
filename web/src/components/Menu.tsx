import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icons';

export interface MenuItem {
  label: string;
  hint: string;
  href: string;
  icon: IconName;
}

/** A button that opens a short list of links. Closes on a click elsewhere, or Escape. */
export function Menu({ label, icon, items }: { label: ReactNode; icon: IconName; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon} /> {label} <Icon name="chevron" size={14} className={open ? 'chevron-up' : ''} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((item) => (
            <a key={item.label} className="menu-item" role="menuitem" href={item.href} onClick={() => setOpen(false)}>
              <span className="menu-icon">
                <Icon name={item.icon} size={17} />
              </span>
              <span className="menu-text">
                <span className="menu-label">{item.label}</span>
                <span className="menu-hint">{item.hint}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
