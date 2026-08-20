/**
 * A process-generation marker carried by INFO packets.
 *
 * Keep the representation lexical-sortable so it remains safe to transport as
 * JSON without losing precision. The wall-clock portion orders normal process
 * restarts, while the monotonic portion breaks ties for starts in the same
 * millisecond on the same host.
 */
export type InstanceEpoch = string;

const WALL_CLOCK_WIDTH = 16;
const MONOTONIC_WIDTH = 24;
const GENERATED_EPOCH_PATTERN = new RegExp(`^(\\d{${WALL_CLOCK_WIDTH}})-(\\d{${MONOTONIC_WIDTH}})$`);

const legacyEpoch = (value: number): InstanceEpoch =>
  `${value.toString().padStart(WALL_CLOCK_WIDTH, '0')}-${''.padStart(MONOTONIC_WIDTH, '0')}`;

/**
 * Generate one marker for the lifetime of a Star instance.
 */
export const generateInstanceEpoch = (): InstanceEpoch => {
  const wallClock = Date.now().toString().padStart(WALL_CLOCK_WIDTH, '0');
  const monotonic = process.hrtime.bigint().toString().padStart(MONOTONIC_WIDTH, '0');
  return `${wallClock}-${monotonic}`;
};

/**
 * Normalize only the current sortable format and small legacy numeric epochs.
 * Invalid values are deliberately treated as absent so older nodes remain
 * compatible without letting arbitrary strings influence ordering.
 */
export const normalizeInstanceEpoch = (value: unknown): InstanceEpoch | null => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (GENERATED_EPOCH_PATTERN.test(normalized)) return normalized;

    if (!/^\d+$/.test(normalized)) return null;
    const numericValue = Number(normalized);
    if (!Number.isSafeInteger(numericValue) || numericValue < 0) return null;
    return legacyEpoch(numericValue);
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return legacyEpoch(value);
  }

  return null;
};

export const compareInstanceEpoch = (left: InstanceEpoch, right: InstanceEpoch): -1 | 0 | 1 => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};
