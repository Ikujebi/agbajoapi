
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailPreheaderOptions {
  text: string;
  previewWidth?: number;
}

/**
 * Generate hidden preview text for email clients.
 *
 * The text is visually hidden in the email body but can be
 * displayed as inbox preview text by supporting email clients.
 */
export function emailPreheader(
  options: EmailPreheaderOptions,
): string {
  const {
    text,
    previewWidth = 160,
  } = options;

  if (
    typeof text !== 'string' ||
    !text.trim()
  ) {
    return '';
  }

  const safeText = escapeHtml(text.trim());

  const safePreviewWidth =
    Number.isInteger(previewWidth) &&
    previewWidth >= 40 &&
    previewWidth <= 300
      ? previewWidth
      : 160;

  // Invisible padding helps prevent email clients from
  // displaying unwanted body text in the inbox preview.
  const padding = '&zwnj;&nbsp;'.repeat(40);

  return `
    <div
      style="
        display:none;
        font-size:1px;
        line-height:1px;
        max-height:0;
        max-width:0;
        opacity:0;
        overflow:hidden;
        mso-hide:all;
        color:transparent;
        width:${safePreviewWidth}px;
      "
    >
      ${safeText}${padding}
    </div>
  `.trim();
}
