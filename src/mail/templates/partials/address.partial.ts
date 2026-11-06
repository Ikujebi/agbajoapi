
import { escapeHtml } from '../layouts/base-layout.template';

export interface EmailAddressOptions {
  title?: string;
  organizationName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  align?: 'left' | 'center' | 'right';
}

/**
 * Accept only HTTPS website URLs.
 */
function safeWebsiteUrl(value: string): string {
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
 * Validate and format phone numbers for telephone links.
 */
function safePhone(value: string): {
  display: string;
  href: string;
} | null {
  const display = value.trim();

  // Allow common international phone-number characters.
  if (!/^[+\d\s().-]{7,25}$/.test(display)) {
    return null;
  }

  const digits = display.replace(/\D/g, '');

  if (digits.length < 7 || digits.length > 15) {
    return null;
  }

  return {
    display: escapeHtml(display),
    href: `tel:+${digits}`,
  };
}

/**
 * Validate email addresses before creating mailto links.
 */
function safeEmail(value: string): string {
  const email = value.trim();

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return '';
  }

  return email;
}

/**
 * Generate organisation address and contact details.
 *
 * All displayed dynamic text is HTML-escaped.
 */
export function emailAddress(
  options: EmailAddressOptions,
): string {
  const {
    title = 'Contact information',
    organizationName,
    address,
    phone,
    email,
    website,
    align = 'left',
  } = options;

  const safeAlign =
    ['left', 'center', 'right'].includes(align)
      ? align
      : 'left';

  const safeTitle = title.trim()
    ? escapeHtml(title.trim())
    : '';

  const safeOrganizationName =
    organizationName?.trim()
      ? escapeHtml(organizationName.trim())
      : '';

  const safeAddress = address?.trim()
    ? escapeHtml(address.trim())
    : '';

  const safePhoneNumber =
    phone?.trim()
      ? safePhone(phone)
      : null;

  const validEmail =
    email?.trim()
      ? safeEmail(email)
      : '';

  const safeWebsite =
    website?.trim()
      ? safeWebsiteUrl(website)
      : '';

  const rows: string[] = [];

  if (safeAddress) {
    rows.push(`
      <tr>
        <td style="padding:3px 0;">
          <span style="color:#777386;font-size:12px;">
            Address:
          </span>
          <span style="color:#403B50;font-size:12px;line-height:19px;">
            ${safeAddress}
          </span>
        </td>
      </tr>
    `);
  }

  if (safePhoneNumber) {
    rows.push(`
      <tr>
        <td style="padding:3px 0;">
          <span style="color:#777386;font-size:12px;">
            Phone:
          </span>
          <a
            href="${safePhoneNumber.href}"
            style="color:#7137A8;font-size:12px;text-decoration:none;"
          >
            ${safePhoneNumber.display}
          </a>
        </td>
      </tr>
    `);
  }

  if (validEmail) {
    const escapedEmail = escapeHtml(validEmail);

    rows.push(`
      <tr>
        <td style="padding:3px 0;">
          <span style="color:#777386;font-size:12px;">
            Email:
          </span>
          <a
            href="mailto:${escapedEmail}"
            style="color:#7137A8;font-size:12px;text-decoration:none;"
          >
            ${escapedEmail}
          </a>
        </td>
      </tr>
    `);
  }

  if (safeWebsite) {
    const websiteLabel = escapeHtml(
      website!.trim().replace(/^https:\/\//i, ''),
    );

    rows.push(`
      <tr>
        <td style="padding:3px 0;">
          <span style="color:#777386;font-size:12px;">
            Website:
          </span>
          <a
            href="${safeWebsite}"
            target="_blank"
            rel="noopener noreferrer"
            style="color:#7137A8;font-size:12px;text-decoration:none;"
          >
            ${websiteLabel}
          </a>
        </td>
      </tr>
    `);
  }

  if (!safeOrganizationName && rows.length === 0) {
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
      <tr>
        <td
          align="${safeAlign}"
          style="
            padding:14px 0;
            border-top:1px solid #E9E7EF;
          "
        >
          ${
            safeTitle
              ? `
                <p style="
                  margin:0 0 6px;
                  color:#777386;
                  font-size:11px;
                  font-weight:700;
                  line-height:18px;
                  text-transform:uppercase;
                  letter-spacing:0.6px;
                ">
                  ${safeTitle}
                </p>
              `
              : ''
          }

          ${
            safeOrganizationName
              ? `
                <p style="
                  margin:0 0 6px;
                  color:#252238;
                  font-size:13px;
                  font-weight:700;
                  line-height:20px;
                ">
                  ${safeOrganizationName}
                </p>
              `
              : ''
          }

          <table
            role="presentation"
            cellpadding="0"
            cellspacing="0"
            border="0"
            align="${safeAlign}"
            style="border-collapse:collapse;"
          >
            ${rows.join('')}
          </table>
        </td>
      </tr>
    </table>
  `.trim();
}
