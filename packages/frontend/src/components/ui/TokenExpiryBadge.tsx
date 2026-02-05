import { Badge } from './Badge';
import { useTranslation } from 'react-i18next';

interface TokenExpiryBadgeProps {
  expiresIn: number | null; // seconds remaining
  isExpired: boolean;
  warningThreshold?: number; // seconds before showing warning (default: 300 = 5 min)
}

/**
 * Format seconds into a human-readable time string
 * @param seconds - Time in seconds
 * @returns Formatted string like "59m", "23h 45m", "29d 12h"
 */
function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Expired';

  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Badge component that displays token expiry status
 * - Red badge with "Expired" if token is expired
 * - Yellow/warning badge if token expires within threshold
 * - Green/success badge if token is valid
 */
export const TokenExpiryBadge = ({
  expiresIn,
  isExpired,
  warningThreshold = 300, // 5 minutes default
}: TokenExpiryBadgeProps) => {
  const { t } = useTranslation();
  // Determine badge variant and text
  if (isExpired || expiresIn === null || expiresIn <= 0) {
    return <Badge variant="danger" size="sm">{t('ui.token_expiry.expired')}</Badge>;
  }

  if (expiresIn < warningThreshold) {
    return (
      <Badge variant="warning" size="sm">
        {formatTimeRemaining(expiresIn)}
      </Badge>
    );
  }

  return (
    <Badge variant="success" size="sm">
      {formatTimeRemaining(expiresIn)}
    </Badge>
  );
};
