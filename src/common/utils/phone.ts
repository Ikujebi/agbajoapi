import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Returns the number in E.164 form (for example +2348031234567), or null if
 * it is not a valid phone number. Numbers without a country code are read
 * as Nigerian, so 08031234567 and +2348031234567 become the same value.
 */
export function tryNormalizePhone(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), 'NG');

  return parsed && parsed.isValid() ? parsed.number : null;
}

/** Same as tryNormalizePhone, but throws a 400 for invalid numbers. */
export function normalizePhone(raw: string): string {
  const normalized = tryNormalizePhone(raw);

  if (!normalized) {
    throw new BadRequestException('Enter a valid phone number.');
  }

  return normalized;
}
