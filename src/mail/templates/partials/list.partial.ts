
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailListOptions {
  items: string[];
  type?: 'bullet' | 'numbered';
  color?: string;
  textColor?: string;
  spacing?: number;
}

/**
 * Validate six-digit hexadecimal colours.
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
 * Generate a reusable email list.
 *
 * Supports bullet and numbered lists.
 * All dynamic item text is HTML-escaped.
 */
export function emailList(
  options: EmailListOptions,
): string {
  const {
    items,
    type = 'bullet',
    color,
    textColor,
    spacing = 8,
  } = options;

  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const safeType =
    type === 'numbered' ? 'numbered' : 'bullet';

  const safeMarkerColor = safeColor(
    color,
    '#7137A8',
  );

  const safeTextColor = safeColor(
    textColor,
    '#403B50',
  );

  const safeSpacing =
    Number.isInteger(spacing) &&
    spacing >= 0 &&
    spacing <= 30
      ? spacing
      : 8;

  const validItems = items
    .filter(
      (item): item is string =>
        typeof item === 'string' &&
        item.trim().length > 0,
    )
    .map((item) => escapeHtml(item.trim()));

  if (validItems.length === 0) {
    return '';
  }

  const rows = validItems
    .map((item, index) => {
      const marker =
        safeType === 'numbered'
          ? `${index + 1}.`
          : '&#8226;';

      return `
        <tr>
          <td
            width="22"
            valign="top"
            style="
              width:22px;
              padding:0 0 ${safeSpacing}px;
              color:${safeMarkerColor};
              font-size:15px;
              font-weight:700;
              line-height:22px;
            "
          >
            ${marker}
          </td>

          <td
            valign="top"
            style="
              padding:0 0 ${safeSpacing}px;
              color:${safeTextColor};
              font-family:Arial,Helvetica,sans-serif;
              font-size:13px;
              line-height:22px;
            "
          >
            ${item}
          </td>
        </tr>
      `;
    })
    .join('');

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
        border-collapse:collapse;
      "
    >
      ${rows}
    </table>
  `.trim();
}
