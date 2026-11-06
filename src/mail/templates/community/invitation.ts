
// src/mail/templates/community/invitation.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface CommunityInvitationOptions {
  recipientName?: string;
  communityName: string;
  inviterName: string;
  invitationUrl: string;
  invitedRole?: string;
  message?: string;
  expiresIn?: string;
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
    throw new Error('A valid HTTPS invitation URL is required.');
  }
}

export function communityInvitationTemplate(
  options: CommunityInvitationOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const communityName = escapeHtml(options.communityName);
  const inviterName = escapeHtml(options.inviterName);
  const invitationUrl = validateHttpsUrl(options.invitationUrl);

  const invitedRole = options.invitedRole
    ? escapeHtml(options.invitedRole)
    : undefined;

  const message = options.message
    ? escapeHtml(options.message)
    : undefined;

  const expiresIn = options.expiresIn
    ? escapeHtml(options.expiresIn)
    : '7 days';

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      You're invited to join ${communityName}
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      <strong>${inviterName}</strong> has invited you to join
      <strong>${communityName}</strong> on AdugboHub.
    </p>

    ${
      invitedRole
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" width="100%"
            style="margin:0 0 20px;background:#f8f6fb;border-radius:10px;">
            <tr>
              <td style="padding:16px;">
                <p style="margin:0 0 6px;color:#777;font-size:12px;">
                  INVITED MEMBERSHIP ROLE
                </p>
                <p style="margin:0;color:#24143f;font-size:15px;font-weight:bold;">
                  ${invitedRole}
                </p>
              </td>
            </tr>
          </table>`
        : ''
    }

    ${
      message
        ? `<div style="margin:0 0 24px;padding:16px;
            background:#f8f6fb;border-left:4px solid #6b3fa0;
            border-radius:6px;">
            <p style="margin:0 0 8px;color:#777;font-size:12px;">
              PERSONAL MESSAGE
            </p>
            <p style="margin:0;color:#555;font-size:14px;line-height:1.8;">
              ${message}
            </p>
          </div>`
        : ''
    }

    <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.7;">
      Accept the invitation below to continue. You may be asked to sign in
      or create an AdugboHub account.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 24px;">
      <tr>
        <td align="center" bgcolor="#d62839" style="border-radius:8px;">
          <a href="${invitationUrl}"
            style="display:inline-block;padding:14px 26px;color:#ffffff;
            font-size:14px;font-weight:bold;text-decoration:none;
            border-radius:8px;">
            Accept invitation
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.7;">
      This invitation expires in ${expiresIn}.
    </p>

    <p style="margin:0;color:#666;font-size:13px;line-height:1.7;">
      If you weren't expecting this invitation, you can safely ignore this
      email.
    </p>

    ${
      supportEmail
        ? `<p style="margin:20px 0 0;color:#777;font-size:13px;">
            Need help? Contact
            <a href="mailto:${supportEmail}" style="color:#6b3fa0;">
              ${supportEmail}
            </a>.
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: `Invitation to join ${options.communityName}`,
    preheader: `${options.inviterName} invited you to join ${options.communityName}.`,
    content,
    footerText:
      options.footerText ??
      `You received this invitation to join ${options.communityName} on AdugboHub.`,
  });
}
