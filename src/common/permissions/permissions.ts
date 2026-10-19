
import { MembershipRole as R, OrgType } from '@prisma/client';

export type Permission =
  | 'org.manage'
  | 'members.view'
  | 'members.manage'
  | 'notice.manage'
  | 'email.broadcast'
  | 'visitor.create'
  | 'visitor.verify'
  | 'gate.view'
  | 'sos.respond'
  | 'product.view'
  | 'product.create'
  | 'product.edit'
  | 'product.delete'
  | 'stock.adjust'
  | 'sale.record'
  | 'order.manage'
  | 'expense.manage'
  | 'finance.view'
  | 'giving.manage'
  | 'attendance.mark'
  | 'event.manage';

const ALL: Permission[] = [
  'org.manage',
  'members.view',
  'members.manage',
  'notice.manage',
  'email.broadcast',
  'visitor.create',
  'visitor.verify',
  'gate.view',
  'sos.respond',
  'product.view',
  'product.create',
  'product.edit',
  'product.delete',
  'stock.adjust',
  'sale.record',
  'order.manage',
  'expense.manage',
  'finance.view',
  'giving.manage',
  'attendance.mark',
  'event.manage',
];

type RoleMap = Partial<Record<R, Permission[]>>;

const ESTATE: RoleMap = {
  OWNER: ALL,
  CHAIRMAN: ALL,
  ADMIN: [
    'members.view',
    'members.manage',
    'notice.manage',
    'email.broadcast',
    'visitor.create',
    'visitor.verify',
    'gate.view',
    'sos.respond',
    'event.manage',
  ],
  SECURITY: [
    'visitor.verify',
    'gate.view',
    'sos.respond',
  ],
  RESIDENT: [
    'visitor.create',
  ],
  MEMBER: [
    'visitor.create',
  ],
};

const SHOP: RoleMap = {
  OWNER: ALL,
  ADMIN: [
    'members.view',
    'members.manage',
    'product.view',
    'product.create',
    'product.edit',
    'product.delete',
    'stock.adjust',
    'sale.record',
    'order.manage',
    'expense.manage',
    'finance.view',
    'notice.manage',
  ],
  MANAGER: [
    'members.view',
    'product.view',
    'product.create',
    'product.edit',
    'stock.adjust',
    'sale.record',
    'order.manage',
    'expense.manage',
  ],
  ACCOUNTANT: [
    'product.view',
    'expense.manage',
    'finance.view',
  ],
  STAFF: [
    'product.view',
    'sale.record',
    'order.manage',
  ],
  MEMBER: [],
};

const WORSHIP: RoleMap = {
  OWNER: ALL,
  SUPER_ADMIN: ALL,
  ADMIN: [
    'members.view',
    'members.manage',
    'notice.manage',
    'email.broadcast',
    'giving.manage',
    'attendance.mark',
    'event.manage',
  ],
  MODERATOR: [
    'members.view',
    'notice.manage',
    'attendance.mark',
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
    'event.manage',
  ],
  MANAGER: [
    'members.view',
    'notice.manage',
    'event.manage',
  ],
  MODERATOR: [
    'members.view',
    'notice.manage',
  ],
  STAFF: [],
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

export const hasPermission = (
  type: OrgType,
  role: R,
  permission: Permission,
): boolean =>
  ORG_PERMISSIONS[type][role]?.includes(permission) ?? false;
