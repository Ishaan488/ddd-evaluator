import type { Strength } from '@ddd/shared';
import { CellChip } from '../../components/Chip';

/** Grouped by criterion, with repeats removed, so ten lines about one thing read as one. */
export function StrengthsList({ strengths }: { strengths: Strength[] }) {
  if (strengths.length === 0) {
    return <p className="muted">No strengths were recorded with supporting evidence.</p>;
  }
  const groups = new Map<string, Strength[]>();
  for (const s of strengths) {
    const list = groups.get(s.dimensionId) ?? [];
    if (!list.some((x) => x.text === s.text)) list.push(s);
    groups.set(s.dimensionId, list);
  }
  return (
    <div className="strength-groups">
      {[...groups].map(([id, list]) => (
        <section key={id} className="strength-group">
          <h3><span className="faint">{id}</span> <span className="chip chip-green">{list.length}</span></h3>
          <ul className="strengths">
            {list.map((s, i) => (
              <li key={i}>
                <span>{s.text}</span>
                {s.location && <CellChip sheet={s.location.sheet} cell={s.location.cell} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
