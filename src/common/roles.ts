import { MembershipRole } from '@prisma/client';

/** Full control of an organization (approve members, change roles, email everyone). */
export const ADMIN_ROLES: MembershipRole[] = ['OWNER', 'CHAIRMAN', 'SUPER_ADMIN', 'ADMIN'];

/** Admins plus day-to-day managers. */
export const MANAGER_ROLES: MembershipRole[] = [...ADMIN_ROLES, 'MANAGER'];

/** Anyone who can work orders/stock in a shop. */
export const SHOP_STAFF_ROLES: MembershipRole[] = [...MANAGER_ROLES, 'STAFF'];

/** Can read money records (orders, payments, expenses). */
export const FINANCE_ROLES: MembershipRole[] = [...MANAGER_ROLES, 'ACCOUNTANT'];

/** Gate access for estates. */
export const GATE_ROLES: MembershipRole[] = [...ADMIN_ROLES, 'SECURITY'];

/** Everyone who is an actual part of an organization. */
export const ALL_MEMBER_ROLES: MembershipRole[] = [
  ...MANAGER_ROLES, 'SECURITY', 'RESIDENT', 'MEMBER', 'STAFF', 'ACCOUNTANT', 'MODERATOR',
];
