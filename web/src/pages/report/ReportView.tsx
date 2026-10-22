import type { RunDetail } from '@ddd/shared';
import { Card } from '../../components/Layout';
import { Tabs, useHashTab, type TabSpec } from '../../components/Tabs';
import { AgreementTable } from './AgreementTable';
import { FindingsList } from './FindingsList';
import { NextSteps } from './NextSteps';
import { NotMeasurable } from './NotMeasurable';
import { PathToGreen } from './PathToGreen';
import { RunDetails } from './RunDetails';
import { ScoresTable } from './ScoresTable';
import { StrengthsList } from './StrengthsList';
import { VerdictHero } from './VerdictHero';

const TAB_IDS = ['scores', 'fix', 'agreement', 'input', 'path', 'strengths', 'tech'];

export function ReportView({ run, onChange }: { run: RunDetail; onChange: (run: RunDetail) => void }) {
  const report = run.report!;
  const pending = report.notMeasurable.filter((n) => !n.evidence).length;
  const flagged = report.agreement.filter((a) => a.flagged).length;
  const blocking = report.verdict.blockingFindings.length;
  const [tab, setTab] = useHashTab(TAB_IDS, report.findings.length > 0 ? 'fix' : 'scores');

  const tabs: TabSpec[] = [
    { id: 'scores', label: 'Scores', count: report.dimensions.length },
    { id: 'fix', label: 'What to fix', count: report.findings.length || undefined, tone: blocking > 0 ? 'red' : 'accent' },
    { id: 'agreement', label: 'Examiner agreement', count: flagged || undefined, tone: 'amber' },
    { id: 'input', label: 'Needs your input', count: pending || undefined, tone: 'amber' },
    { id: 'path', label: 'Path to green' },
    { id: 'strengths', label: 'Strengths', count: report.strengths.length || undefined },
    { id: 'tech', label: 'Technical details' },
  ];

  return (
    <>
      <VerdictHero run={run} onChange={onChange} />
      <NextSteps run={run} onGo={setTab} />

      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Report sections">
        {tab === 'scores' && (
          <Card title="Scores" aside={<span className="faint">Click a row to see why it got that score</span>} flush>
            <ScoresTable report={report} />
          </Card>
        )}
        {tab === 'fix' && (
          <Card title="What to fix" aside={<span className="faint">Most serious first</span>}>
            <FindingsList findings={report.findings} />
          </Card>
        )}
        {tab === 'agreement' && (
          <Card title="Did the examiners agree?" aside={<span className="faint">Agreement is evidence. Disagreement is worth a look.</span>} flush>
            <AgreementTable report={report} />
          </Card>
        )}
        {tab === 'input' && (
          <Card title="Needs your input" aside={<span className="faint">Only a person can supply these</span>}>
            <NotMeasurable run={run} onChange={onChange} />
          </Card>
        )}
        {tab === 'path' && (
          <Card title="Path to green" aside={<span className="faint">The smallest set of fixes that changes the result</span>}>
            <PathToGreen path={report.pathToGreen} />
          </Card>
        )}
        {tab === 'strengths' && (
          <Card title="What is already good" aside={<span className="faint">Keep these in the next version</span>}>
            <StrengthsList strengths={report.strengths} />
          </Card>
        )}
        {tab === 'tech' && (
          <Card title="Technical details" aside={<span className="faint">Everything needed to reproduce this run</span>}>
            <RunDetails run={run} />
          </Card>
        )}
      </Tabs>
    </>
  );
}
