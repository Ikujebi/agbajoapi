
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailCopyrightOptions {
  organizationName?: string;
  year?: number;
  text?: string;
  showPoweredBy?: boolean;
  poweredByName?: string;
  poweredByUrl?: string;
  align?: 'left' | 'center' | 'right';
}

/**
 * Accept only HTTPS URLs.
 */
function safeUrl(value: string): string {
  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'https:') {
      return '';
    }

    return escapeHtml(url.toString());
  } catch {
    return '';
  }
}

/**
 * Generate a reusable copyright footer for email templates.
 */
export function emailCopyright(
  options: EmailCopyrightOptions = {},
): string {
  const {
    organizationName = 'AdugboHub',
    year = new Date().getFullYear(),
    text,
    showPoweredBy = false,
    poweredByName = 'AdugboHub',
    poweredByUrl,
    align = 'center',
  } = options;

  const safeOrganizationName =
    escapeHtml(organizationName.trim());

  const safeYear =
    Number.isInteger(year) && year >= 2000 && year <= 9999
      ? year
      : new Date().getFullYear();

  const safeAlign =
    ['left', 'center', 'right'].includes(align)
      ? align
      : 'center';

  const copyrightText = text?.trim()
    ? escapeHtml(text.trim())
    : `© ${safeYear} ${safeOrganizationName}. All rights reserved.`;

  const safePoweredByName = escapeHtml(
    poweredByName.trim(),
  );

  const safePoweredByUrl = poweredByUrl
    ? safeUrl(poweredByUrl)
    : '';

  return `
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="
        width:100%;
        margin:16px 0 0;
        border-collapse:collapse;
      "
    >
      <tr>
        <td
          align="${safeAlign}"
          style="
            padding:12px 0;
            border-top:1px solid #E9E7EF;
            color:#8A8797;
            font-family:Arial,Helvetica,sans-serif;
            font-size:11px;
            line-height:18px;
          "
        >
          <p style="margin:0;">
            ${copyrightText}
          </p>

          ${
            showPoweredBy
              ? `
                <p style="margin:5px 0 0;">
                  Powered by
                  ${
                    safePoweredByUrl
                      ? `
                        <a
                          href="${safePoweredByUrl}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            color:#7137A8;
                            font-weight:600;
                            text-decoration:none;
                          "
                        >
                          ${safePoweredByName}
                        </a>
                      `
                      : `
                        <strong style="color:#7137A8;">
                          ${safePoweredByName}
                        </strong>
                      `
                  }
                </p>
              `
              : ''
          }
        </td>
      </tr>
    </table>
  `.trim();
}
