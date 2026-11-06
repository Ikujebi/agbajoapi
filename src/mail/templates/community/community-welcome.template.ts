
// src/mail/templates/community/community-welcome.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface CommunityWelcomeOptions {
  recipientName?: string;
  communityName: string;
  communityDescription?: string;
  communityAddress?: string;
  joinedAt?: string;
  communityUrl?: string;
  supportEmail?: string;
  footerText?: string;
}

function validateHttpsUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      throw new Error('URL must use HTTPS.');
    }

    return escapeHtml(url.toString());
  } catch {
    throw new Error('A valid HTTPS community URL is required.');
  }
}

export function communityWelcomeTemplate(
  options: CommunityWelcomeOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const communityName = escapeHtml(options.communityName);

  const description = options.communityDescription
    ? escapeHtml(options.communityDescription)
    : undefined;

  const address = options.communityAddress
    ? escapeHtml(options.communityAddress)
    : undefined;

  const joinedAt = options.joinedAt
    ? escapeHtml(options.joinedAt)
    : undefined;

  const communityUrl = options.communityUrl
    ? validateHttpsUrl(options.communityUrl)
    : undefined;

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      Welcome to ${communityName}!
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      We're glad to welcome you to <strong>${communityName}</strong>.
      You're now part of a neighbourhood community where residents can
      stay informed, connect with one another and access useful local services.
    </p>

    ${
      description
        ? `<p style="margin:0 0 20px;color:#666;font-size:14px;line-height:1.8;">
            ${description}
          </p>`
        : ''
    }

    ${
      address || joinedAt
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" width="100%"
            style="margin:0 0 24px;background:#f8f6fb;border-radius:10px;">
            <tr>
              <td style="padding:18px;">
                ${
                  address
                    ? `<p style="margin:0 0 12px;color:#777;font-size:12px;">
                        COMMUNITY LOCATION
                      </p>
                      <p style="margin:0 0 16px;color:#24143f;font-size:14px;">
                        ${address}
                      </p>`
                    : ''
                }
                ${
                  joinedAt
                    ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                        MEMBERSHIP DATE
                      </p>
                      <p style="margin:0;color:#24143f;font-size:14px;">
                        ${joinedAt}
                      </p>`
                    : ''
                }
              </td>
            </tr>
          </table>`
        : ''
    }

    <h3 style="margin:24px 0 12px;color:#24143f;font-size:17px;">
      Here's what you can do
    </h3>

    <ul style="margin:0 0 24px;padding-left:22px;color:#555;
      font-size:14px;line-height:1.9;">
      <li>Stay updated with community announcements.</li>
      <li>Connect with other residents.</li>
      <li>Discover trusted local businesses and services.</li>
      <li>Access relevant community information and services.</li>
    </ul>

    ${
      communityUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#d62839"
                style="border-radius:8px;">
                <a href="${communityUrl}"
                  style="display:inline-block;padding:14px 26px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  Visit your community
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

    <p style="margin:0;color:#666;font-size:14px;line-height:1.7;">
      We look forward to helping you build a more connected neighbourhood.
    </p>

    ${
      supportEmail
        ? `<p style="margin:20px 0 0;color:#777;font-size:13px;">
            Need assistance? Contact
            <a href="mailto:${supportEmail}" style="color:#6b3fa0;">
              ${supportEmail}
            </a>.
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: `Welcome to ${options.communityName}`,
    preheader: `You're now part of ${options.communityName} on AdugboHub.`,
    content,
    footerText:
      options.footerText ??
      `Welcome to ${options.communityName}. This email confirms your community membership.`,
  });
}
