import React from 'react';
import './ui.css';

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`dk-btn dk-btn--${variant} dk-btn--${size} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, actions = null, className = '' }) {
  return (
    <div className={`page-header-modern v2-page-header ${className}`.trim()}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}

export function SurfaceCard({ title, actions = null, children, className = '' }) {
  return (
    <section className={`v2-card ${className}`.trim()}>
      {(title || actions) && (
        <div className="v2-card__header">
          {title && <h2 className="v2-card__title">{title}</h2>}
          {actions && <div className="v2-card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ children, tone = 'neutral', className = '' }) {
  return (
    <span className={`v2-status v2-status--${tone} ${className}`.trim()}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action = null, className = '' }) {
  return (
    <div className={`v2-empty-state ${className}`.trim()}>
      {title && <h3>{title}</h3>}
      {description && <p>{description}</p>}
      {action && <div className="v2-empty-state__action">{action}</div>}
    </div>
  );
}
