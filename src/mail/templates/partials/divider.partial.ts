
export interface EmailDividerOptions {
  /**
   * Divider colour.
   */
  color?: string;

  /**
   * Divider thickness in pixels.
   */
  thickness?: number;

  /**
   * Vertical spacing above and below.
   */
  spacing?: number;

  /**
   * Optional divider style.
   */
  style?: 'solid' | 'dashed' | 'dotted';
}

/**
 * Validate six-digit hexadecimal colours.
 */
function safeColor(
  value: string | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const color = value.trim();

  return /^#[0-9A-Fa-f]{6}$/.test(color)
    ? color
    : fallback;
}

/**
 * Generate a reusable email divider.
 *
 * Uses email-friendly table markup instead of CSS-only
 * elements for better email client compatibility.
 */
export function emailDivider(
  options: EmailDividerOptions = {},
): string {
  const {
    color = '#E9E7EF',
    thickness = 1,
    spacing = 20,
    style = 'solid',
  } = options;

  const safeThickness =
    Number.isInteger(thickness) &&
    thickness >= 1 &&
    thickness <= 5
      ? thickness
      : 1;

  const safeSpacing =
    Number.isInteger(spacing) &&
    spacing >= 0 &&
    spacing <= 60
      ? spacing
      : 20;

  const safeDividerColor = safeColor(
    color,
    '#E9E7EF',
  );

  const safeStyle =
    ['solid', 'dashed', 'dotted'].includes(style)
      ? style
      : 'solid';

  return `
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="
        width:100%;
        margin:${safeSpacing}px 0;
        border-collapse:collapse;
      "
    >
      <tr>
        <td
          height="${safeThickness}"
          style="
            height:${safeThickness}px;
            border-top:${safeThickness}px ${safeStyle} ${safeDividerColor};
            font-size:0;
            line-height:0;
          "
        >
          &nbsp;
        </td>
      </tr>
    </table>
  `.trim();
}
