
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailInfoItem {
  label: string;
  value: string;
}

export interface EmailInfoCardOptions {
  title?: string;
  items: EmailInfoItem[];
  accentColor?: string;
  backgroundColor?: string;
  borderColor?: string;
}

/**
 * Accept only six-digit hexadecimal colours.
 */
function safeColor(
  value: string | undefined,
  fallback: string,
): string {
  if (!value) return fallback;

  const color = value.trim();

  return /^#[0-9A-Fa-f]{6}$/.test(color)
    ? color
    : fallback;
}

/**
 * Generate a reusable information card for email templates.
 *
 * Dynamic text is escaped before being inserted into HTML.
 */
export function emailInfoCard(
  options: EmailInfoCardOptions,
): string {
  const {
    title,
    items,
    accentColor,
    backgroundColor,
    borderColor,
  } = options;

  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const safeAccent = safeColor(
    accentColor,
    '#7137A8',
  );

  const safeBackground = safeColor(
    backgroundColor,
    '#F8F7FB',
  );

  const safeBorder = safeColor(
    borderColor,
    '#E9E7EF',
  );

  const safeTitle = title?.trim()
    ? escapeHtml(title.trim())
    : '';

  const rows = items
    .filter(
      (item) =>
        typeof item.label === 'string' &&
        typeof item.value === 'string',
    )
    .map((item) => {
      const label = escapeHtml(item.label.trim());
      const value = escapeHtml(item.value.trim());

      if (!label || !value) return '';

      return `
        <tr>
          <td
            valign="top"
            style="
              padding:9px 12px 9px 0;
              color:#777386;
              font-size:13px;
              line-height:20px;
              width:40%;
            "
          >
            ${label}
          </td>

          <td
            valign="top"
            align="right"
            style="
              padding:9px 0;
              color:#252238;
              font-size:13px;
              font-weight:600;
              line-height:20px;
              word-break:break-word;
            "
          >
            ${value}
          </td>
        </tr>
      `;
    })
    .filter(Boolean)
    .join('');

  if (!rows) return '';

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
        border:1px solid ${safeBorder};
        border-radius:12px;
        border-collapse:separate;
        background-color:${safeBackground};
      "
    >
      <tr>
        <td
          style="
            padding:16px 18px;
            border-left:4px solid ${safeAccent};
          "
        >
          ${
            safeTitle
              ? `
                <h3
                  style="
                    margin:0 0 10px;
                    color:#252238;
                    font-size:15px;
                    line-height:22px;
                    font-weight:700;
                  "
                >
                  ${safeTitle}
                </h3>
              `
              : ''
          }

          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="width:100%;"
          >
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `.trim();
}
