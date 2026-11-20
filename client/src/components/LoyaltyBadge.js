import React from 'react';
import { formatTokenBalance } from '../utils/loyaltyTokens';
import './LoyaltyBadge.css';

const TIER_LABELS = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  vip: 'VIP',
};

/**
 * Compact loyalty tier badge — shows tokens (1 token / TSh 20,000 earned).
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
  const tokensLabel = Number.isFinite(pts) ? Math.max(0, Math.floor(pts)) : 0;

  return (
    <span
      className={`loyalty-badge loyalty-badge--${size} loyalty-badge--${tierKey} ${className}`.trim()}
      title={`${label} · ${formatTokenBalance(tokensLabel)} (1 token = TSh 500 redeem)`}
    >
      <span className="loyalty-badge__tier">{label}</span>
      {showPoints && (
        <span className="loyalty-badge__points">
          {tokensLabel} tok
        </span>
      )}
    </span>
  );
}
