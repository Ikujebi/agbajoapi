
import { escapeHtml } from '../layouts/base-layout.template';

export type EmailNoticeVariant =
  | 'default'
  | 'muted'
  | 'important';

export interface EmailNoticeOptions {
  message: string;
  title?: string;
  variant?: EmailNoticeVariant;
}

interface NoticeTheme {
  background: string;
  border: string;
  title: string;
  text: string;
}

const NOTICE_THEMES: Record<
  EmailNoticeVariant,
  NoticeTheme
> = {
  default: {
    background: '#F8F7FB',
    border: '#E9E7EF',
    title: '#403B50',
    text: '#666174',
  },

  muted: {
    background: '#F9FAFB',
    border: '#EAECF0',
    title: '#667085',
    text: '#667085',
  },

  important: {
    background: '#FDF4FF',
    border: '#E9D7FE',
    title: '#6941C6',
    text: '#53389E',
  },
};

/**
 * Generate a supporting notice for email templates.
 *
 * Dynamic text is HTML-escaped.
 */
export function emailNotice(
  options: EmailNoticeOptions,
): string {
  const {
    message,
    title,
    variant = 'default',
  } = options;

  if (
    typeof message !== 'string' ||
    !message.trim()
  ) {
    return '';
  }

  const safeVariant: EmailNoticeVariant =
    Object.prototype.hasOwnProperty.call(
      NOTICE_THEMES,
      variant,
    )
      ? variant
      : 'default';

  const theme = NOTICE_THEMES[safeVariant];

  const safeTitle = title?.trim()
    ? escapeHtml(title.trim())
    : '';

  const safeMessage = escapeHtml(message.trim());

  return `
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="
        width:100%;
        margin:16px 0;
        border-collapse:separate;
        border-spacing:0;
        background-color:${theme.background};
        border:1px solid ${theme.border};
        border-radius:8px;
      "
    >
      <tr>
        <td
          style="
            padding:14px 16px;
          "
        >
          ${
            safeTitle
              ? `
                <p
                  style="
                    margin:0 0 5px;
                    color:${theme.title};
                    font-family:Arial,Helvetica,sans-serif;
                    font-size:12px;
                    font-weight:700;
                    line-height:18px;
                  "
                >
                  ${safeTitle}
                </p>
              `
              : ''
          }

          <p
            style="
              margin:0;
              color:${theme.text};
              font-family:Arial,Helvetica,sans-serif;
              font-size:12px;
              line-height:19px;
            "
          >
            ${safeMessage}
          </p>
        </td>
      </tr>
    </table>
  `.trim();
}
