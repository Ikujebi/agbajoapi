
// src/mail/templates/community/membership-approved.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface MembershipApprovedOptions {
  recipientName?: string;
  communityName: string;
  approvedBy?: string;
  approvedAt?: string;
  membershipRole?: string;
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

export function membershipApprovedTemplate(
  options: MembershipApprovedOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const communityName = escapeHtml(options.communityName);

  const approvedBy = options.approvedBy
    ? escapeHtml(options.approvedBy)
    : 'Community Administration';

  const approvedAt = options.approvedAt
    ? escapeHtml(options.approvedAt)
    : undefined;

  const membershipRole = options.membershipRole
    ? escapeHtml(options.membershipRole)
    : undefined;

  const communityUrl = options.communityUrl
    ? validateHttpsUrl(options.communityUrl)
    : undefined;

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <div style="margin:0 0 20px;">
      <span style="display:inline-block;padding:6px 12px;
        background:#e8f7ef;color:#18794e;border-radius:20px;
        font-size:12px;font-weight:bold;">
        MEMBERSHIP APPROVED
      </span>
    </div>

    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      You're officially a member!
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      Great news! Your request to join <strong>${communityName}</strong>
      has been approved. You can now access the community as an approved
      member on AdugboHub.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      width="100%" style="margin:0 0 24px;background:#f8f6fb;
      border-radius:10px;">
      <tr>
        <td style="padding:18px;">
          <p style="margin:0 0 6px;color:#777;font-size:12px;">
            COMMUNITY
          </p>
          <p style="margin:0 0 16px;color:#24143f;font-size:15px;font-weight:bold;">
            ${communityName}
          </p>

          ${
            membershipRole
              ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                  MEMBERSHIP ROLE
                </p>
                <p style="margin:0 0 16px;color:#24143f;font-size:14px;">
                  ${membershipRole}
                </p>`
              : ''
          }

          <p style="margin:0 0 6px;color:#777;font-size:12px;">
            APPROVED BY
          </p>
          <p style="margin:0;color:#24143f;font-size:14px;">
            ${approvedBy}
          </p>

          ${
            approvedAt
              ? `<p style="margin:8px 0 0;color:#777;font-size:12px;">
                  ${approvedAt}
                </p>`
              : ''
          }
        </td>
      </tr>
    </table>

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
      Welcome aboard. We look forward to seeing you participate and connect
      with your neighbours.
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
    title: `Membership approved | ${options.communityName}`,
    preheader: `Your membership request for ${options.communityName} has been approved.`,
    content,
    footerText:
      options.footerText ??
      `This email confirms your membership approval for ${options.communityName}.`,
  });
}
