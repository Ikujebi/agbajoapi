
import { escapeHtml } from '../layouts/base-layout.template';

export type EmailAlertType =
  | 'success'
  | 'info'
  | 'warning'
  | 'error';

export interface EmailAlertOptions {
  type?: EmailAlertType;
  title?: string;
  message: string;
}

interface AlertTheme {
  background: string;
  border: string;
  title: string;
  text: string;
  icon: string;
}

const ALERT_THEMES: Record<EmailAlertType, AlertTheme> = {
  success: {
    background: '#ECFDF3',
    border: '#12B76A',
    title: '#027A48',
    text: '#05603A',
    icon: '✓',
  },

  info: {
    background: '#EFF8FF',
    border: '#2E90FA',
    title: '#175CD3',
    text: '#1849A9',
    icon: 'i',
  },

  warning: {
    background: '#FFFAEB',
    border: '#F79009',
    title: '#B54708',
    text: '#93370D',
    icon: '!',
  },

  error: {
    background: '#FEF3F2',
    border: '#F04438',
    title: '#B42318',
    text: '#912018',
    icon: '!',
  },
};

/**
 * Generate a reusable alert component for email templates.
 *
 * Dynamic text is HTML-escaped.
 * Colours and icons are selected from predefined themes.
 */
export function emailAlert(
  options: EmailAlertOptions,
): string {
  const {
    type = 'info',
    title,
    message,
  } = options;

  if (
    typeof message !== 'string' ||
    !message.trim()
  ) {
    return '';
  }

  const safeType: EmailAlertType =
    Object.prototype.hasOwnProperty.call(
      ALERT_THEMES,
      type,
    )
      ? type
      : 'info';

  const theme = ALERT_THEMES[safeType];

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
        margin:20px 0;
        border-collapse:separate;
        border-spacing:0;
        background-color:${theme.background};
        border-left:4px solid ${theme.border};
        border-radius:8px;
      "
    >
      <tr>
        <td
          width="42"
          valign="top"
          align="center"
          style="
            width:42px;
            padding:16px 0 16px 12px;
          "
        >
          <span
            style="
              display:inline-block;
              width:24px;
              height:24px;
              border-radius:50%;
              background-color:${theme.border};
              color:#FFFFFF;
              font-size:14px;
              font-weight:700;
              line-height:24px;
              text-align:center;
            "
          >
            ${theme.icon}
          </span>
        </td>

        <td
          valign="top"
          style="padding:16px 16px 16px 10px;"
        >
          ${
            safeTitle
              ? `
                <p
                  style="
                    margin:0 0 5px;
                    color:${theme.title};
                    font-size:14px;
                    font-weight:700;
                    line-height:20px;
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
              font-size:13px;
              line-height:21px;
            "
          >
            ${safeMessage}
          </p>
        </td>
      </tr>
    </table>
  `.trim();
}
