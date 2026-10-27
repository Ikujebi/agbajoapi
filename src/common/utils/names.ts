import { Prisma } from '@prisma/client';

/** Select these wherever a person's name is shown. */
export const NAME_SELECT = {
  firstName: true,
  otherNames: true,
  lastName: true,
} as const;

export interface NameParts {
  firstName: string;
  otherNames?: string | null;
  lastName: string;
}

/** "Ada Grace Okafor", skipping empty parts. */
export function displayName(user: NameParts): string {
  return [user.firstName, user.otherNames, user.lastName]
    .filter((part) => part?.trim())
    .join(' ');
}

/**
 * Prisma filter for searching people by name. Each word typed must match
 * the first, other or last name, so "ada okafor" finds Ada Grace Okafor.
 */
export function nameSearchWhere(term: string): Prisma.UserWhereInput {
  const tokens = term.split(/\s+/).filter(Boolean).slice(0, 4);

  return {
    AND: tokens.map((token) => ({
      OR: [
        { firstName: { contains: token, mode: 'insensitive' } },
        { otherNames: { contains: token, mode: 'insensitive' } },
        { lastName: { contains: token, mode: 'insensitive' } },
      ],
    })),
  };
}
