
// src/mail/templates/auth/otp.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export type OtpPurpose =
  | 'SIGN_IN'
  | 'VERIFY_EMAIL'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_VERIFICATION'
  | 'GENERAL';

export interface OtpEmailOptions {
  recipientName?: string;
  code: string;
  expiresIn?: string;
  purpose?: OtpPurpose;
  supportEmail?: string;
  footerText?: string;
}

const purposeLabels: Record<OtpPurpose, string> = {
  SIGN_IN: 'complete your sign-in',
  VERIFY_EMAIL: 'verify your email address',
  PASSWORD_RESET: 'reset your password',
  ACCOUNT_VERIFICATION: 'verify your account',
  GENERAL: 'complete your request',
};

export function otpTemplate(options: OtpEmailOptions): string {
  const name = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const code = escapeHtml(options.code);
  const expiresIn = options.expiresIn
    ? escapeHtml(options.expiresIn)
    : '10 minutes';

  const purpose =
    purposeLabels[options.purpose ?? 'GENERAL'];

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      Your one-time password
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.7;">
      Use the code below to ${purpose}.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      width="100%" style="margin:0 0 24px;">
      <tr>
        <td align="center" bgcolor="#f5f0fa"
          style="padding:22px;border-radius:10px;">
          <span style="color:#6b3fa0;font-size:32px;font-weight:bold;
            letter-spacing:8px;">
            ${code}
          </span>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 12px;color:#666;font-size:14px;line-height:1.7;">
      This code expires in ${expiresIn}.
    </p>

    <p style="margin:0 0 12px;color:#b42318;font-size:14px;line-height:1.7;">
      Never share this code with anyone. AdugboHub will never ask you to
      disclose your one-time password.
    </p>

    <p style="margin:0;color:#666;font-size:14px;line-height:1.7;">
      If you did not request this code, you can ignore this email.
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
    title: 'Your AdugboHub one-time password',
    preheader: 'Your one-time password is ready.',
    content,
    footerText:
      options.footerText ??
      'This is an automated security email from AdugboHub.',
  });
}
