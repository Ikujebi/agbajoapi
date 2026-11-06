
import { escapeHtml } from '../layouts/base-layout.template';

export type EmailHeadingLevel = 1 | 2 | 3;

export interface EmailHeadingOptions {
  text: string;
  level?: EmailHeadingLevel;
  color?: string;
  align?: 'left' | 'center' | 'right';
  marginTop?: number;
  marginBottom?: number;
}

const HEADING_SIZES: Record<EmailHeadingLevel, number> = {
  1: 26,
  2: 20,
  3: 16,
};

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
 * Generate a reusable heading for email templates.
 *
 * Dynamic text is HTML-escaped.
 */
export function emailHeading(
  options: EmailHeadingOptions,
): string {
  const {
    text,
    level = 1,
    color,
    align = 'left',
    marginTop = 0,
    marginBottom = 16,
  } = options;

  if (
    typeof text !== 'string' ||
    !text.trim()
  ) {
    return '';
  }

  const safeLevel: EmailHeadingLevel =
    level === 1 || level === 2 || level === 3
      ? level
      : 1;

  const safeColor = /^#[0-9A-Fa-f]{6}$/.test(
    color?.trim() ?? '',
  )
    ? color!.trim()
    : '#252238';

  const safeAlign =
    ['left', 'center', 'right'].includes(align)
      ? align
      : 'left';

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

  const safeText = escapeHtml(text.trim());

  const fontSize = HEADING_SIZES[safeLevel];

  return `
    <h${safeLevel}
      style="
        margin:${safeMarginTop}px 0 ${safeMarginBottom}px;
        color:${safeColor};
        font-family:Arial,Helvetica,sans-serif;
        font-size:${fontSize}px;
        font-weight:700;
        line-height:1.3;
        text-align:${safeAlign};
      "
    >
      ${safeText}
    </h${safeLevel}>
  `.trim();
}
