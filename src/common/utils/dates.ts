import { BadRequestException } from '@nestjs/common';

/** Parses an ISO date string, or throws a 400 naming the field. */
export function parseDate(value: string, field: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is not a valid date.`);
  }

  return date;
}
