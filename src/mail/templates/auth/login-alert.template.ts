
// src/mail/templates/auth/login-alert.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface LoginAlertOptions {
  recipientName?: string;
  loginAt?: string;
  device?: string;
  browser?: string;
  location?: string;
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

export function loginAlertTemplate(
  options: LoginAlertOptions,
): string {
  const name = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const loginAt = options.loginAt
    ? escapeHtml(options.loginAt)
    : 'Recently';

  const accountUrl = options.accountUrl
    ? validateAccountUrl(options.accountUrl)
    : undefined;

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const details = [
    options.device
      ? `<tr>
          <td style="padding:8px 0;color:#777;font-size:13px;">Device</td>
          <td align="right" style="padding:8px 0;color:#333;font-size:13px;">
            ${escapeHtml(options.device)}
          </td>
        </tr>`
      : '',
    options.browser
      ? `<tr>
          <td style="padding:8px 0;color:#777;font-size:13px;">Browser</td>
          <td align="right" style="padding:8px 0;color:#333;font-size:13px;">
            ${escapeHtml(options.browser)}
          </td>
        </tr>`
      : '',
    options.location
      ? `<tr>
          <td style="padding:8px 0;color:#777;font-size:13px;">Location</td>
          <td align="right" style="padding:8px 0;color:#333;font-size:13px;">
            ${escapeHtml(options.location)}
          </td>
        </tr>`
      : '',
  ].join('');

  const content = `
    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      New sign-in detected
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.7;">
      We detected a sign-in to your AdugboHub account. Here are the details
      available for this sign-in:
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      width="100%" style="margin:0 0 24px;background:#f8f6fb;
      border-radius:10px;padding:16px;">
      <tr>
        <td style="padding:8px 0;color:#777;font-size:13px;">
          Sign-in time
        </td>
        <td align="right" style="padding:8px 0;color:#333;font-size:13px;">
          ${loginAt}
        </td>
      </tr>
      ${details}
    </table>

    <p style="margin:0 0 12px;color:#555;font-size:14px;line-height:1.7;">
      If this was you, no action is needed.
    </p>

    <p style="margin:0;color:#b42318;font-size:14px;line-height:1.7;">
      If you do not recognise this sign-in, secure your account and contact
      support as soon as possible.
    </p>

    ${
      accountUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#d62839"
                style="border-radius:8px;">
                <a href="${accountUrl}"
                  style="display:inline-block;padding:13px 24px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  Review my account
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
    title: 'New sign-in to your AdugboHub account',
    preheader: 'A new sign-in to your AdugboHub account was detected.',
    content,
    footerText:
      options.footerText ??
      'This is an automated security notification from AdugboHub.',
  });
}
