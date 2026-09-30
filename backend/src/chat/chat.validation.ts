export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢'] as const;

export const MAX_USERNAME_LENGTH = 32;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_USERNAME_LENGTH) return null;
  return trimmed;
}

export function isReactionEmoji(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (REACTION_EMOJIS as readonly string[]).includes(value)
  );
}
