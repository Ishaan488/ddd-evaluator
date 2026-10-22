import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api } from '../api';
import { useResource } from '../hooks';
import { timeAgo } from '../format';
import { Icon } from './Icons';

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="DDD Evaluator home">
      <span className="brand-mark">
        <Icon name="check" size={16} strokeWidth={2.6} />
      </span>
      <span className="brand-text">
        <span className="brand-name">DDD Evaluator</span>
        <span className="brand-sub">Level 1 · Evaluator agents</span>
      </span>
    </NavLink>
  );
}

function Sidebar() {
  const { pathname } = useLocation();
  const projects = useResource(api.projects, [pathname]);
  const config = useResource(api.config, []);

  return (
    <aside className="sidebar">
      <Brand />
      <nav className="nav" aria-label="Main">
        <NavLink to="/new" className="btn btn-primary nav-cta">
          <Icon name="plus" /> New evaluation
        </NavLink>
        <NavLink to="/" end className="nav-link">
          <Icon name="folder" /> Projects
        </NavLink>
        <NavLink to="/models" className="nav-link">
          <Icon name="cpu" /> Evaluator models
        </NavLink>
      </nav>

      <div className="side-section">
        <div className="side-title">Recent</div>
        <div className="side-list">
          {(projects.data ?? []).slice(0, 7).map((p) => (
            <NavLink key={p.id} to={`/projects/${p.id}`} className="side-item">
              <span className={`dot dot-${p.latest?.finalDecision ?? 'none'}`} />
              <span className="side-item-name">{p.name}</span>
              <span className="side-item-meta">{timeAgo(p.latest?.createdAt)}</span>
            </NavLink>
          ))}
          {projects.data?.length === 0 && <p className="side-empty">Nothing evaluated yet.</p>}
        </div>
      </div>

      <div className="side-foot">
        {config.data && (
          <div className={`mode ${config.data.mock ? 'mode-mock' : config.data.ready ? 'mode-live' : 'mode-warn'}`}>
            <span className="dot" />
            {config.data.mock ? 'Mock models (demo)' : config.data.ready ? 'Live models ready' : 'Models need setup'}
          </div>
        )}
        <p className="side-note">Agents recommend. People approve every gate.</p>
      </div>
    </aside>
  );
}

export function Layout() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <div className="main-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children && <div className="page-sub">{children}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  aside,
  children,
  id,
  className = '',
  flush = false,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section id={id} className={`card ${className}`}>
      {(title || aside) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {aside && <div className="card-aside">{aside}</div>}
        </div>
      )}
      <div className={flush ? 'card-body card-flush' : 'card-body'}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner-red" role="alert">
      <Icon name="alert" />
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}…
    </div>
  );
}
