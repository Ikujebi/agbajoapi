import { MembershipRole as R, OrgType } from '@prisma/client';

export const PERMISSIONS = [
  // organization
  'org.manage',
  'members.view',
  'members.manage',
  'notice.manage',
  'email.broadcast',
  'hours.manage',
  'sms.broadcast',
  'wallet.manage',
  // estates
  'visitor.create',
  'visitor.verify',
  'gate.view',
  'sos.respond',
  // shops: catalogue and stock
  'product.view',
  'product.create',
  'product.edit',
  'product.delete',
  'stock.adjust',
  'sale.record',
  // shops: orders and delivery
  'order.view',
  'order.manage',
  'delivery.perform',
  // money
  'expense.manage',
  'finance.view',
  // worship
  'giving.manage',
  'attendance.mark',
  'event.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

type RoleMap = Partial<Record<R, Permission[]>>;

const ESTATE: RoleMap = {
  CHAIRMAN: ALL,
  ADMIN: [
    'members.view',
    'members.manage',
    'notice.manage',
    'email.broadcast',
    'hours.manage',
    'sms.broadcast',
    'visitor.create',
    'gate.view',
    'sos.respond',
    'event.manage',
  ],
  SECURITY: ['visitor.verify', 'gate.view', 'sos.respond'],
  MEMBER: ['visitor.create'],
};

const SHOP: RoleMap = {
  OWNER: ALL,
  MANAGER: [
    'members.view',
    'members.manage',
    'hours.manage',
    'product.view',
    'product.create',
    'product.edit',
    'stock.adjust',
    'sale.record',
    'order.view',
    'order.manage',
    'delivery.perform',
    'expense.manage',
  ],
  ACCOUNTANT: [
    'product.view',
    'order.view',
    'expense.manage',
    'finance.view',
    'wallet.manage',
  ],
  ATTENDANT: [
    'product.view',
    'sale.record',
    'order.view',
    'order.manage',
    'delivery.perform',
  ],
  RIDER: ['delivery.perform'],
  MEMBER: [],
};

const WORSHIP: RoleMap = {
  SUPER_ADMIN: ALL,
  ADMIN: [
    'members.view',
    'members.manage',
    'notice.manage',
    'email.broadcast',
    'hours.manage',
    'sms.broadcast',
    'giving.manage',
    'attendance.mark',
    'event.manage',
  ],
  MEMBER: [],
};

const GENERIC: RoleMap = {
  OWNER: ALL,
  ADMIN: [
    'members.view',
    'members.manage',
    'notice.manage',
    'email.broadcast',
    'hours.manage',
    'sms.broadcast',
    'event.manage',
  ],
  MEMBER: [],
};

export const ORG_PERMISSIONS: Record<OrgType, RoleMap> = {
  ESTATE,
  SHOP,
  CHURCH: WORSHIP,
  MOSQUE: WORSHIP,
  ARTISAN: GENERIC,
  COMPANY: GENERIC,
  COMMUNITY_GROUP: GENERIC,
  OTHER: GENERIC,
};

export const TOP_ROLE: Record<OrgType, R> = {
  ESTATE: 'CHAIRMAN',
  SHOP: 'OWNER',
  CHURCH: 'SUPER_ADMIN',
  MOSQUE: 'SUPER_ADMIN',
  ARTISAN: 'OWNER',
  COMPANY: 'OWNER',
  COMMUNITY_GROUP: 'OWNER',
  OTHER: 'OWNER',
};

export const allowedRoles = (type: OrgType): R[] =>
  Object.keys(ORG_PERMISSIONS[type]) as R[];

export const hasPermission = (type: OrgType, role: R, p: Permission): boolean =>
  ORG_PERMISSIONS[type][role]?.includes(p) ?? false;

/** Every role of this org type that holds the permission. */
export const rolesWith = (type: OrgType, p: Permission): R[] =>
  allowedRoles(type).filter((role) => hasPermission(type, role, p));