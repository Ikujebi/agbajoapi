
// src/mail/templates/auth/email-verification.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface EmailVerificationOptions {
  recipientName?: string;
  verificationUrl: string;
  expiresIn?: string;
  supportEmail?: string;
  footerText?: string;
}

function validateHttpsUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      throw new Error('Verification URL must use HTTPS.');
    }

    return escapeHtml(url.toString());
  } catch {
    throw new Error('A valid HTTPS verification URL is required.');
  }
}

export function emailVerificationTemplate(
  options: EmailVerificationOptions,
): string {
  const name = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const verificationUrl = validateHttpsUrl(options.verificationUrl);
  const expiresIn = options.expiresIn
    ? escapeHtml(options.expiresIn)
    : '24 hours';

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      Verify your email address
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.7;">
      Thank you for creating an AdugboHub account. Please verify your email
      address to complete your registration.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 24px;">
      <tr>
        <td align="center" bgcolor="#d62839" style="border-radius:8px;">
          <a href="${verificationUrl}"
            style="display:inline-block;padding:14px 26px;color:#ffffff;
            font-size:15px;font-weight:bold;text-decoration:none;
            border-radius:8px;">
            Verify email address
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 12px;color:#666;font-size:14px;line-height:1.7;">
      This verification link expires in ${expiresIn}.
    </p>

    <p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.7;">
      If the button does not work, copy and paste this link into your browser:
    </p>

    <p style="margin:0 0 24px;word-break:break-all;font-size:13px;line-height:1.7;">
      <a href="${verificationUrl}" style="color:#6b3fa0;">
        ${verificationUrl}
      </a>
    </p>

    <p style="margin:0;color:#666;font-size:14px;line-height:1.7;">
      If you did not create an AdugboHub account, you can ignore this email.
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
    title: 'Verify your AdugboHub email',
    preheader: 'Complete your AdugboHub registration by verifying your email.',
    content,
    footerText:
      options.footerText ??
      'You received this email because an AdugboHub account was created using this email address.',
  });
}
