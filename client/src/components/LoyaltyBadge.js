import React from 'react';
import './LoyaltyBadge.css';

const TIER_LABELS = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  vip: 'VIP',
};

/**
 * Compact loyalty tier badge for cashiers when a customer is pulled up.
 * Safe with missing data — defaults to Bronze / 0 pts.
 */
export default function LoyaltyBadge({
  tier,
  points,
  showPoints = true,
  size = 'sm',
  className = '',
}) {
  const rawTier = String(tier || 'Bronze').trim() || 'Bronze';
  const tierKey = rawTier.toLowerCase();
  const label = TIER_LABELS[tierKey] || rawTier;
  const pts = Number(points);
  const pointsLabel = Number.isFinite(pts) ? Math.max(0, Math.floor(pts)) : 0;

  return (
    <span
      className={`loyalty-badge loyalty-badge--${size} loyalty-badge--${tierKey} ${className}`.trim()}
      title={`${label} member · ${pointsLabel} points`}
    >
      <span className="loyalty-badge__tier">{label}</span>
      {showPoints && <span className="loyalty-badge__points">{pointsLabel} pts</span>}
    </span>
  );
}
