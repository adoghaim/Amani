/**
 * Dev-only component gallery.
 *
 * Most of Amani's surfaces sit behind auth, which makes them awkward to review
 * visually — you cannot see the dashboard without a session and a seeded
 * account. This renders the shared pieces against fixed sample data so layout,
 * type and colour can be checked directly, including the states that are hard
 * to reach on demand (an out-of-range flag, an empty cycle, each phase).
 *
 * Gated behind import.meta.env.DEV in App.tsx, so it is not in production
 * bundles. Sample records are cast rather than fully constructed: this file
 * never runs against real data, and spelling out every column would obscure
 * what is actually being previewed.
 */
import { CycleDial } from '../components/CycleDial';
import { TodayCard } from '../components/TodayCard';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { CycleMark } from '../components/CycleMark';
import { BiomarkerCard } from '../components/BiomarkerCard';
import type { CyclePhase } from '../types';

const PHASES: CyclePhase[] = ['menstrual', 'follicular', 'ovulatory', 'luteal'];

const prediction = {
  nextPeriodStart: new Date(Date.now() + 7 * 86_400_000),
  nextPeriodEnd: new Date(Date.now() + 12 * 86_400_000),
  fertileWindowStart: new Date(), fertileWindowEnd: new Date(), ovulationDay: new Date(),
  currentCycleDay: 21, currentPhase: 'luteal' as CyclePhase, cycleLength: 28, periodLength: 5,
};

const sample = {
  lastPeriodLog: { start_date: '2026-08-01', end_date: '2026-08-05' },
  periodLogs: [1, 2, 3, 4, 5, 6],
  lastReport: { report_date: '2026-03-14', lab_name: 'Quest Diagnostics', estimated_cycle_phase: 'luteal' },
  activeInterventions: [{ title: 'Iron bisglycinate' }, { title: 'Earlier bedtime' }],
  symptomLogsThisCycle: [1, 2, 3],
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-theme-muted-text-3 mb-4 pb-2 border-b border-theme-border-inner">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DesignGallery() {
  return (
    <div className="min-h-dvh bg-theme-background">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <header className="mb-12 flex items-center gap-3">
          <CycleMark className="w-7 h-7 text-theme-primary" />
          <div>
            <h1 className="text-3xl leading-none">Design gallery</h1>
            <p className="text-sm text-theme-muted-text-2 mt-1.5">Dev only. Shared components against fixed sample data.</p>
          </div>
        </header>

        <Section title="Cycle dial — every phase">
          <div className="flex flex-wrap gap-8">
            {PHASES.map((p, i) => (
              <div key={p} className="text-center">
                <CycleDial day={[3, 9, 14, 21][i] ?? 1} length={28} phase={p} size={84} />
                <p className="text-xs text-theme-muted-text-2 mt-2 capitalize">{p}</p>
              </div>
            ))}
            <div className="text-center">
              <CycleDial day={null} length={28} phase="unknown" size={84} />
              <p className="text-xs text-theme-muted-text-2 mt-2">unknown</p>
            </div>
          </div>
        </Section>



        <Section title="Today card">
          <div className="max-w-xl">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <TodayCard {...(sample as any)} prediction={prediction} onLogPeriod={() => {}} onAddSymptom={() => {}} onUploadLabs={() => {}} />
          </div>
        </Section>

        <Section title="Today card — nothing logged yet">
          <div className="max-w-xl">
            <TodayCard
              prediction={null}
              lastReport={null}
              activeInterventions={[]}
              lastPeriodLog={null}
              periodLogs={[]}
              symptomLogsThisCycle={[]}
              onLogPeriod={() => {}}
              onAddSymptom={() => {}}
              onUploadLabs={() => {}}
            />
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid sm:grid-cols-3 gap-5 max-w-3xl">
            <Input label="Email" placeholder="you@example.com" />
            <Input label="Cycle length" numeric defaultValue="28" hint="Days, start to start" />
            <Input label="Password" type="password" error="Password must be at least 8 characters" />
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid sm:grid-cols-2 gap-5 max-w-3xl">
            <Card><p className="text-sm">Flat by default — no elevation claim.</p></Card>
            <Card elevated><p className="text-sm">Elevated, for content that outranks its neighbours.</p></Card>
          </div>
        </Section>

        <Section title="Biomarker card — in range, watch, below range">
          <div className="grid lg:grid-cols-3 gap-5">
            <BiomarkerCard
              name="estradiol" value={142} unit="pg/mL"
              labRefMin={26} labRefMax={165} cyclePhase="luteal"
              historicalValues={[
                { date: '2025-10-19', value: 96 },
                { date: '2026-01-02', value: 118 },
                { date: '2026-03-14', value: 142 },
              ]}
            />
            <BiomarkerCard
              name="tsh" value={4.12} unit="mIU/L"
              labRefMin={0.45} labRefMax={4.5}
              historicalValues={[
                { date: '2025-10-19', value: 2.4 },
                { date: '2026-01-02', value: 3.3 },
                { date: '2026-03-14', value: 4.12 },
              ]}
            />
            <BiomarkerCard
              name="ferritin" value={18} unit="ng/mL"
              labRefMin={15} labRefMax={150}
              historicalValues={[
                { date: '2025-10-19', value: 41 },
                { date: '2026-01-02', value: 28 },
                { date: '2026-03-14', value: 18 },
              ]}
            />
          </div>
        </Section>

        <Section title="Result flags">
          <div className="grid sm:grid-cols-3 gap-4 max-w-3xl">
            {[
              ['flag-ok', 'In range', 'Estradiol 142 pg/mL'],
              ['flag-watch', 'Watch', 'TSH 4.12 mIU/L'],
              ['flag-low', 'Below range', 'Ferritin 18 ng/mL'],
            ].map(([tok, label, val]) => (
              <div key={tok} className={`rounded-xl border p-4 bg-theme-${tok}-bg border-theme-${tok}-border`}>
                <p className={`font-mono text-[11px] uppercase tracking-wider text-theme-${tok} mb-1.5`}>{label}</p>
                <p className="font-mono text-sm text-theme-text tabular-nums">{val}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
