/**
 * Environment variable names used by the mail module.
 *
 * Keep these names aligned with your deployment environment.
 */
export const MAIL_CONFIG_KEYS = {
  API_KEY: 'RESEND_API_KEY',

  FROM_EMAIL: 'RESEND_FROM',

  FALLBACK_FROM_EMAIL: 'MAIL_FROM',

  FROM_NAME: 'MAIL_FROM_NAME',

  REPLY_TO: 'MAIL_REPLY_TO',

  LOGO_URL: 'MAIL_LOGO_URL',

  WEBSITE_URL: 'MAIL_WEBSITE_URL',

  SUPPORT_EMAIL: 'MAIL_SUPPORT_EMAIL',
} as const;

/**
 * Default AdugboHub email branding.
 */
export const MAIL_DEFAULTS = {
  BRAND_NAME: 'AdugboHub',

  WEBSITE_URL: 'https://adugbohub.com',

  LOGO_URL:
    'https://res.cloudinary.com/wndv1ma4/image/upload/v1793890904/logo-purple.png',

  PRIMARY_COLOR: '#D92D45',

  SECONDARY_COLOR: '#7137A8',

  HEADER_BACKGROUND: '#190021',

  BACKGROUND_COLOR: '#F5F6FA',

  TEXT_COLOR: '#252238',

  MUTED_COLOR: '#777487',

  BORDER_COLOR: '#E9E7EF',

  SUPPORT_EMAIL: '',
} as const;

/**
 * Email delivery defaults.
 */
export const MAIL_DELIVERY_DEFAULTS = {
  /**
   * Maximum number of emails submitted in one Resend batch.
   */
  BULK_BATCH_SIZE: 100,

  DEFAULT_LANGUAGE: 'en',
} as const;

/**
 * Email template categories.
 */
export const MAIL_TEMPLATE_CATEGORIES = {
  AUTH: 'AUTH',
  COMMUNITY: 'COMMUNITY',
  EVENTS: 'EVENTS',
  MARKETPLACE: 'MARKETPLACE',
  ORGANIZATIONS: 'ORGANIZATIONS',
  SYSTEM: 'SYSTEM',
} as const;

export type MailTemplateCategory =
  (typeof MAIL_TEMPLATE_CATEGORIES)[keyof typeof MAIL_TEMPLATE_CATEGORIES];

/**
 * Common email subject prefixes.
 */
export const MAIL_SUBJECT_PREFIXES = {
  SECURITY: 'Security alert',
  ACCOUNT: 'Account notification',
  COMMUNITY: 'Community update',
  EVENT: 'Event update',
  ORDER: 'Order update',
  PAYMENT: 'Payment update',
} as const;

/**
 * Supported email content types.
 */
export const MAIL_CONTENT_TYPES = {
  HTML: 'text/html',
  PLAIN_TEXT: 'text/plain',
} as const;