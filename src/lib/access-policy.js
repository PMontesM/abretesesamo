export const RECOVERY_PAUSE_MS = 120000;
export const COMMAND_TTL_SECONDS = 10;
export const REQUEST_MAX_AGE_MS = 24 * 3600000;
export const REQUEST_FUTURE_SKEW_MS = 5 * 60000;
export const ACTIVITY_RETENTION_MS = 30 * 86400000;
export const AUDIT_RETENTION_MS = 90 * 86400000;

// Internal SQL fragment shared by automatic recovery and manual review.
export const relayReleaseSQL = () =>
  `MAX(created_at+${RECOVERY_PAUSE_MS},COALESCE(expires_at*1000+${RECOVERY_PAUSE_MS},0),COALESCE(release_at,0))`;
