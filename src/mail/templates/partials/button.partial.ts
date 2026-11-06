
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailButtonOptions {
  /**
   * Text displayed inside the button.
   */
  label: string;

  /**
   * Destination URL.
   * HTTPS URLs only.
   */
  url: string;

  /**
   * Button appearance.
   */
  variant?: 'primary' | 'secondary' | 'outline';

  /**
   * Optional custom background colour.
   */
  backgroundColor?: string;

  /**
   * Optional custom text colour.
   */
  textColor?: string;

  /**
   * Optional alignment.
   */
  align?: 'left' | 'center' | 'right';

  /**
   * Optional button width.
   */
  width?: number;
}

const BUTTON_BRAND = {
  red: '#D92D45',
  purple: '#7137A8',
  white: '#FFFFFF',
  text: '#252238',
  border: '#E9E7EF',
};

/**
 * Validate an email button destination.
 */
function getSafeUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      return '';
    }

    return escapeHtml(url.toString());
  } catch {
    return '';
  }
}

/**
 * Validate six-digit hexadecimal colours.
 */
function getSafeColor(
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
 * Generate a reusable, email-client-friendly CTA button.
 *
 * Uses table-based HTML for better compatibility
 * with Outlook and other email clients.
 */
export function emailButton(
  options: EmailButtonOptions,
): string {
  const {
    label,
    url,
    variant = 'primary',
    backgroundColor,
    textColor,
    align = 'center',
    width = 220,
  } = options;

  const safeLabel = escapeHtml(label.trim());
  const safeHref = getSafeUrl(url);

  if (!safeLabel || !safeHref) {
    return '';
  }

  const safeWidth =
    Number.isInteger(width) && width >= 100 && width <= 500
      ? width
      : 220;

  let defaultBackground: string;
  let defaultTextColor: string;
  let border: string;

  switch (variant) {
    case 'secondary':
      defaultBackground = BUTTON_BRAND.purple;
      defaultTextColor = BUTTON_BRAND.white;
      border = `1px solid ${BUTTON_BRAND.purple}`;
      break;

    case 'outline':
      defaultBackground = BUTTON_BRAND.white;
      defaultTextColor = BUTTON_BRAND.purple;
      border = `1px solid ${BUTTON_BRAND.purple}`;
      break;

    case 'primary':
    default:
      defaultBackground = BUTTON_BRAND.red;
      defaultTextColor = BUTTON_BRAND.white;
      border = `1px solid ${BUTTON_BRAND.red}`;
      break;
  }

  const background = getSafeColor(
    backgroundColor,
    defaultBackground,
  );

  const foreground = getSafeColor(
    textColor,
    defaultTextColor,
  );

  return `
    <table
      role="presentation"
      cellpadding="0"
      cellspacing="0"
      border="0"
      align="${align}"
      style="
        margin:24px 0;
        border-collapse:separate;
      "
    >
      <tr>
        <td
          align="center"
          bgcolor="${background}"
          style="
            background:${background};
            border:${border};
            border-radius:8px;
            text-align:center;
          "
        >
          <a
            href="${safeHref}"
            target="_blank"
            style="
              display:inline-block;
              min-width:${safeWidth}px;
              padding:14px 22px;
              box-sizing:border-box;
              color:${foreground};
              font-family:Arial,Helvetica,sans-serif;
              font-size:14px;
              font-weight:700;
              line-height:20px;
              text-align:center;
              text-decoration:none;
              border-radius:8px;
            "
          >
            ${safeLabel}
          </a>
        </td>
      </tr>
    </table>
  `.trim();
}
