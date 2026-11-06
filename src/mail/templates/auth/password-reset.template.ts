
// src/mail/templates/auth/password-reset.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface PasswordResetOptions {
  recipientName?: string;
  resetUrl: string;
  expiresIn?: string;
  supportEmail?: string;
  footerText?: string;
}

function validateResetUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      throw new Error('Reset URL must use HTTPS.');
    }

    return escapeHtml(url.toString());
  } catch {
    throw new Error('A valid HTTPS password-reset URL is required.');
  }
}

export function passwordResetTemplate(
  options: PasswordResetOptions,
): string {
  const name = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const resetUrl = validateResetUrl(options.resetUrl);
  const expiresIn = options.expiresIn
    ? escapeHtml(options.expiresIn)
    : '30 minutes';

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      Reset your password
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.7;">
      We received a request to reset the password for your AdugboHub account.
      Click the button below to choose a new password.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 24px;">
      <tr>
        <td align="center" bgcolor="#d62839" style="border-radius:8px;">
          <a href="${resetUrl}"
            style="display:inline-block;padding:14px 26px;color:#ffffff;
            font-size:15px;font-weight:bold;text-decoration:none;
            border-radius:8px;">
            Reset my password
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 12px;color:#666;font-size:14px;line-height:1.7;">
      This link expires in ${expiresIn}. It can only be used according to
      your account's password-reset rules.
    </p>

    <p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.7;">
      If the button does not work, copy and paste this link into your browser:
    </p>

    <p style="margin:0 0 24px;word-break:break-all;font-size:13px;line-height:1.7;">
      <a href="${resetUrl}" style="color:#6b3fa0;">
        ${resetUrl}
      </a>
    </p>

    <p style="margin:0;color:#666;font-size:14px;line-height:1.7;">
      If you did not request a password reset, ignore this email. Your
      password will remain unchanged.
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
    title: 'Reset your AdugboHub password',
    preheader: 'Use the secure link to reset your AdugboHub password.',
    content,
    footerText:
      options.footerText ??
      'This is an automated security email from AdugboHub.',
  });
}
