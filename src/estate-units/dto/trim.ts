import { Transform } from 'class-transformer';

/** Trims string values before validation. Non-strings pass through untouched. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
