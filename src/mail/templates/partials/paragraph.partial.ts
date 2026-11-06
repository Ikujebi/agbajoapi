
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailParagraphOptions {
  text: string;
  color?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  marginTop?: number;
  marginBottom?: number;
  bold?: boolean;
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
 * Generate a reusable email paragraph.
 *
 * Dynamic text is HTML-escaped.
 */
export function emailParagraph(
  options: EmailParagraphOptions,
): string {
  const {
    text,
    color,
    fontSize = 14,
    align = 'left',
    lineHeight = 23,
    marginTop = 0,
    marginBottom = 16,
    bold = false,
  } = options;

  if (
    typeof text !== 'string' ||
    !text.trim()
  ) {
    return '';
  }

  const safeText = escapeHtml(text.trim());

  const safeTextColor = safeColor(
    color,
    '#403B50',
  );

  const safeAlign =
    ['left', 'center', 'right'].includes(align)
      ? align
      : 'left';

  const safeFontSize =
    Number.isInteger(fontSize) &&
    fontSize >= 11 &&
    fontSize <= 24
      ? fontSize
      : 14;

  const safeLineHeight =
    Number.isInteger(lineHeight) &&
    lineHeight >= 16 &&
    lineHeight <= 40
      ? lineHeight
      : 23;

  const safeMarginTop =
    Number.isInteger(marginTop) &&
    marginTop >= 0 &&
    marginTop <= 60
      ? marginTop
      : 0;

  const safeMarginBottom =
    Number.isInteger(marginBottom) &&
    marginBottom >= 0 &&
    marginBottom <= 60
      ? marginBottom
      : 16;

  return `
    <p
      style="
        margin:${safeMarginTop}px 0 ${safeMarginBottom}px;
        color:${safeTextColor};
        font-family:Arial,Helvetica,sans-serif;
        font-size:${safeFontSize}px;
        font-weight:${bold ? 700 : 400};
        line-height:${safeLineHeight}px;
        text-align:${safeAlign};
      "
    >
      ${safeText}
    </p>
  `.trim();
}
