
// src/mail/templates/auth/password-changed.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface PasswordChangedOptions {
  recipientName?: string;
  changedAt?: string;
  accountUrl?: string;
  supportEmail?: string;
  footerText?: string;
}

function validateAccountUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      throw new Error('Account URL must use HTTPS.');
    }

    return escapeHtml(url.toString());
  } catch {
    throw new Error('A valid HTTPS account URL is required.');
  }
}

export function passwordChangedTemplate(
  options: PasswordChangedOptions,
): string {
  const name = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const changedAt = options.changedAt
    ? escapeHtml(options.changedAt)
    : 'just now';

  const accountUrl = options.accountUrl
    ? validateAccountUrl(options.accountUrl)
    : undefined;

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      Your password has been changed
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.7;">
      The password for your AdugboHub account was successfully changed.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      width="100%" style="margin:0 0 24px;">
      <tr>
        <td bgcolor="#f5f0fa" style="padding:18px;border-radius:10px;">
          <p style="margin:0 0 6px;color:#777;font-size:12px;">
            PASSWORD CHANGE
          </p>
          <p style="margin:0;color:#24143f;font-size:15px;font-weight:bold;">
            ${changedAt}
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;color:#555;font-size:14px;line-height:1.7;">
      If you made this change, no further action is needed.
    </p>

    <p style="margin:0;color:#b42318;font-size:14px;line-height:1.7;">
      If you did not change your password, contact our support team
      immediately and secure your account.
    </p>

    ${
      accountUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#6b3fa0"
                style="border-radius:8px;">
                <a href="${accountUrl}"
                  style="display:inline-block;padding:13px 24px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  Open my account
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

    ${
      supportEmail
        ? `<p style="margin:20px 0 0;color:#777;font-size:13px;">
            Contact support:
            <a href="mailto:${supportEmail}" style="color:#6b3fa0;">
              ${supportEmail}
            </a>
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: 'Your AdugboHub password was changed',
    preheader: 'Your account password was successfully updated.',
    content,
    footerText:
      options.footerText ??
      'This is an important security notification from AdugboHub.',
  });
}
