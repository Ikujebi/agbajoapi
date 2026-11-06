
import { escapeHtml } from '../layouts/base-layout.template';

export type EmailBadgeStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'PAID'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED'
  | 'PROCESSING'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'DEFAULT';

export interface EmailBadgeOptions {
  label?: string;
  status?: EmailBadgeStatus;
}

interface BadgeTheme {
  background: string;
  color: string;
  border: string;
}

const BADGE_THEMES: Record<EmailBadgeStatus, BadgeTheme> = {
  APPROVED: {
    background: '#ECFDF3',
    color: '#027A48',
    border: '#ABEFC6',
  },
  PAID: {
    background: '#ECFDF3',
    color: '#027A48',
    border: '#ABEFC6',
  },
  COMPLETED: {
    background: '#ECFDF3',
    color: '#027A48',
    border: '#ABEFC6',
  },
  ACTIVE: {
    background: '#ECFDF3',
    color: '#027A48',
    border: '#ABEFC6',
  },
  PENDING: {
    background: '#FFFAEB',
    color: '#B54708',
    border: '#FEDF89',
  },
  PROCESSING: {
    background: '#EFF8FF',
    color: '#175CD3',
    border: '#B2DDFF',
  },
  CANCELLED: {
    background: '#FEF3F2',
    color: '#B42318',
    border: '#FECDCA',
  },
  REJECTED: {
    background: '#FEF3F2',
    color: '#B42318',
    border: '#FECDCA',
  },
  FAILED: {
    background: '#FEF3F2',
    color: '#B42318',
    border: '#FECDCA',
  },
  INACTIVE: {
    background: '#F2F4F7',
    color: '#475467',
    border: '#D0D5DD',
  },
  EXPIRED: {
    background: '#F2F4F7',
    color: '#475467',
    border: '#D0D5DD',
  },
  DEFAULT: {
    background: '#F2F4F7',
    color: '#475467',
    border: '#D0D5DD',
  },
};

/**
 * Generate a reusable status badge for email templates.
 */
export function emailBadge(
  options: EmailBadgeOptions,
): string {
  const {
    label,
    status = 'DEFAULT',
  } = options;

  const safeStatus: EmailBadgeStatus =
    Object.prototype.hasOwnProperty.call(
      BADGE_THEMES,
      status,
    )
      ? status
      : 'DEFAULT';

  const theme = BADGE_THEMES[safeStatus];

  const displayLabel =
    typeof label === 'string' && label.trim()
      ? label.trim()
      : safeStatus === 'DEFAULT'
        ? 'INFORMATION'
        : safeStatus;

  const safeLabel = escapeHtml(displayLabel);

  return `
    <table
      role="presentation"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="
        display:inline-table;
        border-collapse:separate;
        border-spacing:0;
        margin:4px 0;
      "
    >
      <tr>
        <td
          style="
            padding:5px 11px;
            background-color:${theme.background};
            border:1px solid ${theme.border};
            border-radius:20px;
            color:${theme.color};
            font-family:Arial,Helvetica,sans-serif;
            font-size:11px;
            font-weight:700;
            line-height:16px;
            letter-spacing:0.4px;
            white-space:nowrap;
          "
        >
          ${safeLabel}
        </td>
      </tr>
    </table>
  `.trim();
}
