
// src/mail/templates/community/membership-rejected.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface MembershipRejectedOptions {
  recipientName?: string;
  communityName: string;
  reason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  canReapply?: boolean;
  reapplyUrl?: string;
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
    throw new Error('A valid HTTPS reapplication URL is required.');
  }
}

export function membershipRejectedTemplate(
  options: MembershipRejectedOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const communityName = escapeHtml(options.communityName);

  const reason = options.reason
    ? escapeHtml(options.reason)
    : undefined;

  const reviewedBy = options.reviewedBy
    ? escapeHtml(options.reviewedBy)
    : undefined;

  const reviewedAt = options.reviewedAt
    ? escapeHtml(options.reviewedAt)
    : undefined;

  const reapplyUrl = options.reapplyUrl
    ? validateHttpsUrl(options.reapplyUrl)
    : undefined;

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  if (options.reapplyUrl && !options.canReapply) {
    throw new Error(
      'Set canReapply to true before providing a reapplication URL.',
    );
  }

  const content = `
    <div style="margin:0 0 20px;">
      <span style="display:inline-block;padding:6px 12px;
        background:#fff4e5;color:#9a6700;border-radius:20px;
        font-size:12px;font-weight:bold;">
        MEMBERSHIP UPDATE
      </span>
    </div>

    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      Update on your membership request
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      Thank you for your interest in joining <strong>${communityName}</strong>.
      After reviewing your request, the community administration is unable
      to approve your membership at this time.
    </p>

    ${
      reason
        ? `<div style="margin:0 0 24px;padding:18px;
            background:#f8f6fb;border-left:4px solid #6b3fa0;
            border-radius:6px;">
            <p style="margin:0 0 8px;color:#777;font-size:12px;">
              REVIEW NOTE
            </p>
            <p style="margin:0;color:#555;font-size:14px;line-height:1.8;">
              ${reason}
            </p>
          </div>`
        : ''
    }

    ${
      reviewedBy || reviewedAt
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" width="100%"
            style="margin:0 0 24px;background:#f8f6fb;border-radius:10px;">
            <tr>
              <td style="padding:16px;">
                ${
                  reviewedBy
                    ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                        REVIEWED BY
                      </p>
                      <p style="margin:0 0 12px;color:#24143f;font-size:14px;">
                        ${reviewedBy}
                      </p>`
                    : ''
                }
                ${
                  reviewedAt
                    ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                        REVIEW DATE
                      </p>
                      <p style="margin:0;color:#24143f;font-size:14px;">
                        ${reviewedAt}
                      </p>`
                    : ''
                }
              </td>
            </tr>
          </table>`
        : ''
    }

    ${
      options.canReapply
        ? `<p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.8;">
            You may be able to submit another membership request, subject
            to the community's membership requirements.
          </p>`
        : `<p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.8;">
            If you believe this decision was made in error, you can contact
            the community administration for clarification.
          </p>`
    }

    ${
      reapplyUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#6b3fa0"
                style="border-radius:8px;">
                <a href="${reapplyUrl}"
                  style="display:inline-block;padding:14px 26px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  Submit another request
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

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

    <p style="margin:24px 0 0;color:#777;font-size:13px;line-height:1.7;">
      Thank you for your understanding.
    </p>
  `;

  return baseEmailLayout({
    title: `Membership update | ${options.communityName}`,
    preheader: `There is an update on your request to join ${options.communityName}.`,
    content,
    footerText:
      options.footerText ??
      `This is an update regarding your membership request for ${options.communityName}.`,
  });
}
