import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, ChevronDown, HardDrive } from 'lucide-react';
import { Link, useLocation } from 'wouter';

export function DisciplineChooser() {
  const [discipline, setDiscipline] = useState<'' | 'pfd' | 'pid'>('');
  const [, setLocation] = useLocation();

  const openWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (discipline) setLocation(`/workspace/${discipline}`);
  };

  return (
    <main className="chooser-page">
      <header className="chooser-top">
        <Link href="/" className="studio-wordmark" aria-label="Mapping Studio home" data-testid="link-home"><span className="wordmark-icon">PM</span> Mapping Studio</Link>
        <span className="local-chip"><span className="local-dot" />Browser-local workspace</span>
      </header>
      <section className="chooser-content" aria-labelledby="chooser-title">
        <div className="chooser-intro">
          <div className="eyebrow">Engineering workspace</div>
          <h1 id="chooser-title">Choose a discipline</h1>
          <p>Keep drawing groups organized and traceable on this device.</p>
        </div>
        <form className="discipline-picker" onSubmit={openWorkspace} data-testid="form-discipline-picker">
          <div className="discipline-field">
            <label htmlFor="discipline-select">Drawing type</label>
            <div className="discipline-select-control">
              <select
                id="discipline-select"
                value={discipline}
                onChange={(event) => setDiscipline(event.target.value as '' | 'pfd' | 'pid')}
                aria-label="Drawing type"
                data-testid="select-discipline"
              >
                <option value="" disabled>Select PFD or P&amp;ID</option>
                <option value="pfd">PFD — Process Flow Diagram</option>
                <option value="pid">P&amp;ID — Piping and Instrumentation Diagram</option>
              </select>
              <ChevronDown size={17} aria-hidden="true" />
            </div>
          </div>
          <button className="btn primary discipline-submit" type="submit" disabled={!discipline} data-testid="button-open-discipline">
            Open workspace <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        <div className="chooser-foot">
          <HardDrive size={15} />
          <span><strong>Stored in this browser only.</strong> Nothing is uploaded or shared.</span>
        </div>
      </section>
      <footer className="chooser-footer"><span>LOCAL-FIRST ENGINEERING WORKSPACE</span><span>PDF and DWG files stay in this browser</span></footer>
    </main>
  );
}

export function WorkspaceNotFound() {
  return (
    <main className="chooser-page not-found">
      <div className="not-found-card">
        <div className="eyebrow">Page not found</div>
        <h1>This workspace does not exist.</h1>
        <Link href="/" className="btn primary" data-testid="link-not-found-home">Return to disciplines</Link>
      </div>
    </main>
  );
}
