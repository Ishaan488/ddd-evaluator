import { useEffect, useState } from 'react';

export interface Section {
  id: string;
  label: string;
  count?: number;
}

/** A sticky bar that jumps between report sections and follows the one in view. */
export function SectionNav({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const targets = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="section-nav" aria-label="Report sections">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`section-tab ${active === s.id ? 'section-tab-active' : ''}`}
          onClick={() => {
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActive(s.id);
          }}
        >
          {s.label}
          {s.count !== undefined && <span className="section-count">{s.count}</span>}
        </button>
      ))}
    </nav>
  );
}
