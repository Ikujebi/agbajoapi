import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrganizationInvitationOptions {
  recipientName?: string;
  organizationName: string;
  invitedBy?: string;
  organizationDescription?: string;
  invitationMessage?: string;
  invitationUrl: string;
  expiresAt?: string;
  roleLabel?: string;
  footerText?: string;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      throw new Error('Invitation URL must use HTTPS.');
    }

    return url.toString();
  } catch {
    throw new Error('A valid HTTPS invitation URL is required.');
  }
}

export function organizationInvitationTemplate(
  options: OrganizationInvitationOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const organization = escapeHtml(options.organizationName);
  const invitationUrl = safeUrl(options.invitationUrl);

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;padding:10px 16px;background:#fcecef;color:#a91e3b;border-radius:30px;font-size:12px;font-weight:700;">
        You're invited
      </div>
      <h2 style="margin:16px 0 0;color:#24243a;font-size:23px;line-height:1.35;">
        Join ${organization}
      </h2>
    </div>

    <p style="margin:0 0 16px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, you've been invited to become part of <strong>${organization}</strong>.
    </p>

    ${
      options.invitedBy
        ? `<p style="margin:0 0 16px;color:#55556a;font-size:14px;line-height:1.7;">
            Invitation sent by <strong>${escapeHtml(options.invitedBy)}</strong>.
          </p>`
        : ''
    }

    ${
      options.organizationDescription
        ? `<div style="padding:16px;background:#f8f7fb;border-radius:12px;margin-bottom:18px;">
            <p style="margin:0;color:#55556a;font-size:14px;line-height:1.7;">
              ${escapeHtml(options.organizationDescription)}
            </p>
          </div>`
        : ''
    }

    ${
      options.roleLabel
        ? `<p style="margin:0 0 16px;color:#55556a;font-size:14px;">
            <strong>Invited role:</strong> ${escapeHtml(options.roleLabel)}
          </p>`
        : ''
    }

    ${
      options.invitationMessage
        ? `<div style="margin:18px 0;padding:16px;border-left:3px solid #c62845;background:#fff8f9;border-radius:6px;">
            <p style="margin:0;color:#55556a;font-size:14px;line-height:1.7;">
              ${escapeHtml(options.invitationMessage)}
            </p>
          </div>`
        : ''
    }

    <p style="margin:26px 0;text-align:center;">
      <a href="${escapeHtml(invitationUrl)}" style="display:inline-block;padding:14px 26px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
        Accept invitation
      </a>
    </p>

    ${
      options.expiresAt
        ? `<p style="margin:0;color:#88889a;font-size:12px;text-align:center;">
            This invitation expires on ${escapeHtml(options.expiresAt)}.
          </p>`
        : ''
    }

    <p style="margin:20px 0 0;color:#88889a;font-size:12px;line-height:1.6;">
      If you weren't expecting this invitation, you can safely ignore this email.
    </p>
  `;

  return baseEmailLayout({
    title: `Invitation to join ${options.organizationName}`,
    preheader: `You've been invited to join ${options.organizationName}.`,
    content,
    footerText: options.footerText,
  });
}