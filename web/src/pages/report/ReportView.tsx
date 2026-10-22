import type { RunDetail } from '@ddd/shared';
import { CellChip } from '../../components/Chip';
import { Card } from '../../components/Layout';
import { SectionNav } from '../../components/SectionNav';
import { AgreementTable } from './AgreementTable';
import { FindingsList } from './FindingsList';
import { NotMeasurable } from './NotMeasurable';
import { PathToGreen } from './PathToGreen';
import { RunDetails } from './RunDetails';
import { ScoresTable } from './ScoresTable';
import { VerdictHero } from './VerdictHero';

export function ReportView({ run, onChange }: { run: RunDetail; onChange: (run: RunDetail) => void }) {
  const report = run.report!;
  const pending = report.notMeasurable.filter((n) => !n.evidence).length;
  const flagged = report.agreement.filter((a) => a.flagged).length;

  const sections = [
    { id: 'verdict', label: 'Verdict' },
    { id: 'scores', label: 'Scores', count: report.dimensions.length },
    { id: 'findings', label: 'Findings', count: report.findings.length },
    { id: 'agreement', label: 'Rater agreement', count: flagged > 0 ? flagged : undefined },
    { id: 'human', label: 'Needs a person', count: pending > 0 ? pending : undefined },
    { id: 'path', label: 'Path to green' },
    { id: 'strengths', label: 'Strengths', count: report.strengths.length },
    { id: 'run', label: 'Run details' },
  ];

  return (
    <>
      <VerdictHero run={run} onChange={onChange} />
      <SectionNav sections={sections} />

      <Card id="scores" title="Dimension scores" aside={<span className="faint">Each rater’s score, the consolidated score and the spread</span>} flush>
        <ScoresTable report={report} />
      </Card>

      <Card id="findings" title="Gaps and findings" aside={<span className="faint">Most severe first</span>}>
        <FindingsList findings={report.findings} />
      </Card>

      <Card id="agreement" title="Rater agreement" aside={<span className="faint">Agreement is evidence. Disagreement is a finding.</span>} flush>
        <AgreementTable report={report} />
      </Card>

      <Card id="human" title="Not measurable here" aside={<span className="faint">Only a person can supply these</span>}>
        <NotMeasurable run={run} onChange={onChange} />
      </Card>

      <Card id="path" title="Path to green" aside={<span className="faint">The smallest set of fixes that changes the verdict</span>}>
        <PathToGreen path={report.pathToGreen} />
      </Card>

      <Card id="strengths" title="Strengths" aside={<span className="faint">Keep these in the next version</span>}>
        {report.strengths.length === 0 ? (
          <p className="muted">No strengths were recorded with supporting evidence.</p>
        ) : (
          <ul className="strengths">
            {report.strengths.map((s, i) => (
              <li key={i}>
                <span className="mono faint">{s.dimensionId}</span>
                <span>{s.text}</span>
                {s.location && <CellChip sheet={s.location.sheet} cell={s.location.cell} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="run" title="Run details" aside={<span className="faint">Everything needed to reproduce this run</span>}>
        <RunDetails run={run} />
      </Card>
    </>
  );
}
