
import type { MailTemplateCategory } from './mail.constants';

/**
 * A single email recipient.
 */
export type MailRecipient = string;

/**
 * One recipient or multiple recipients.
 */
export type MailRecipientList =
  | MailRecipient
  | MailRecipient[];

/**
 * Email attachment representation.
 *
 * This is a provider-neutral application type.
 * Map it to the attachment format required by Resend
 * inside MailService before using it.
 */
export interface MailAttachment {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  contentId?: string;
}

/**
 * Additional email headers.
 */
export type MailHeaders = Record<string, string>;

/**
 * Optional settings for sending an email.
 *
 * idempotencyKey prevents duplicate submissions when
 * retrying the same email operation.
 */
export interface MailSendOptions {
  idempotencyKey?: string;

  from?: string;
  replyTo?: string | string[];
  cc?: MailRecipientList;
  bcc?: MailRecipientList;
  headers?: MailHeaders;
  attachments?: MailAttachment[];
}

/**
 * Standard email message representation.
 */
export interface MailMessage {
  to: MailRecipientList;
  subject: string;
  html: string;
  options?: MailSendOptions;
}

/**
 * One message in a bulk email operation.
 */
export interface MailBulkMessage {
  to: MailRecipient;
  subject: string;
  html: string;
  options?: MailSendOptions;
}

/**
 * Generic mail provider response.
 *
 * Provider-specific properties can be added by the
 * MailService implementation when needed.
 */
export interface MailSendResult {
  id?: string;
  success: boolean;
  error?: string;
}

/**
 * Result for an individual recipient in a bulk operation.
 */
export interface MailBulkRecipientResult {
  email: MailRecipient;
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Aggregate bulk email result.
 */
export interface MailBulkSendResult {
  total: number;
  accepted: number;
  failed: number;
  results: MailBulkRecipientResult[];
}

/**
 * Reusable email template function.
 */
export type MailTemplate<TOptions = unknown> = (
  options: TOptions,
) => string;

/**
 * Basic metadata for a reusable email template.
 */
export interface MailTemplateDefinition<TOptions = unknown> {
  name: string;
  category: MailTemplateCategory;
  description?: string;
  generate: MailTemplate<TOptions>;
}

/**
 * Common email branding options.
 */
export interface MailBranding {
  name?: string;
  logoUrl?: string | null;
  websiteUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  headerBackground?: string;
  logoAlt?: string;
}

/**
 * Email delivery statistics.
 */
export interface MailDeliveryStats {
  total: number;
  accepted: number;
  failed: number;
}
