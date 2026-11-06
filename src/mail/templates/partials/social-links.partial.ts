
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailSocialLink {
  label: string;
  url: string;
}

export interface EmailSocialLinksOptions {
  links: EmailSocialLink[];
  title?: string;
  align?: 'left' | 'center' | 'right';
}

function safeUrl(value: string): string {
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
 * Generate reusable social-media links for email templates.
 *
 * Only HTTPS links are accepted.
 * Dynamic labels and URLs are HTML-escaped.
 */
export function emailSocialLinks(
  options: EmailSocialLinksOptions,
): string {
  const {
    links,
    title = 'Connect with us',
    align = 'center',
  } = options;

  if (!Array.isArray(links) || links.length === 0) {
    return '';
  }

  const safeAlign =
    ['left', 'center', 'right'].includes(align)
      ? align
      : 'center';

  const safeTitle = title.trim()
    ? escapeHtml(title.trim())
    : '';

  const renderedLinks = links
    .filter(
      (link) =>
        typeof link.label === 'string' &&
        typeof link.url === 'string',
    )
    .map((link) => {
      const label = escapeHtml(link.label.trim());
      const url = safeUrl(link.url.trim());

      if (!label || !url) {
        return '';
      }

      return `
        <td
          align="center"
          style="padding:5px 9px;"
        >
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
            style="
              color:#7137A8;
              font-family:Arial,Helvetica,sans-serif;
              font-size:12px;
              font-weight:600;
              line-height:18px;
              text-decoration:none;
            "
          >
            ${label}
          </a>
        </td>
      `;
    })
    .filter(Boolean)
    .join('');

  if (!renderedLinks) {
    return '';
  }

  return `
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="
        width:100%;
        margin:18px 0;
        border-collapse:collapse;
      "
    >
      ${
        safeTitle
          ? `
            <tr>
              <td
                align="${safeAlign}"
                style="
                  padding:0 0 8px;
                  color:#777386;
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:12px;
                  line-height:18px;
                "
              >
                ${safeTitle}
              </td>
            </tr>
          `
          : ''
      }

      <tr>
        <td align="${safeAlign}">
          <table
            role="presentation"
            cellpadding="0"
            cellspacing="0"
            border="0"
            align="${safeAlign}"
            style="border-collapse:collapse;"
          >
            <tr>
              ${renderedLinks}
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `.trim();
}
