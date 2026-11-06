
// src/mail/templates/community/community-announcement.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface CommunityAnnouncementOptions {
  recipientName?: string;
  communityName: string;
  announcementTitle: string;
  message: string;
  category?: string;
  publishedBy?: string;
  publishedAt?: string;
  actionLabel?: string;
  actionUrl?: string;
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
    throw new Error('A valid HTTPS action URL is required.');
  }
}

function formatMessage(value: string): string {
  return value
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.8;">${escapeHtml(
          paragraph,
        ).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export function communityAnnouncementTemplate(
  options: CommunityAnnouncementOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'Resident';

  const communityName = escapeHtml(options.communityName);
  const title = escapeHtml(options.announcementTitle);
  const category = options.category
    ? escapeHtml(options.category)
    : 'Community Update';

  const publishedBy = options.publishedBy
    ? escapeHtml(options.publishedBy)
    : 'Community Administration';

  const publishedAt = options.publishedAt
    ? escapeHtml(options.publishedAt)
    : undefined;

  const actionUrl = options.actionUrl
    ? validateHttpsUrl(options.actionUrl)
    : undefined;

  if (options.actionLabel && !actionUrl) {
    throw new Error('An actionUrl is required when actionLabel is provided.');
  }

  const content = `
    <div style="margin:0 0 20px;">
      <span style="display:inline-block;padding:6px 12px;
        background:#f3eafa;color:#6b3fa0;border-radius:20px;
        font-size:12px;font-weight:bold;">
        ${category}
      </span>
    </div>

    <h2 style="margin:0 0 12px;color:#24143f;font-size:24px;line-height:1.4;">
      ${title}
    </h2>

    <p style="margin:0 0 24px;color:#777;font-size:13px;line-height:1.6;">
      ${communityName}
    </p>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    ${formatMessage(options.message)}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      width="100%" style="margin:24px 0;background:#f8f6fb;
      border-radius:10px;">
      <tr>
        <td style="padding:16px;">
          <p style="margin:0 0 6px;color:#777;font-size:12px;">
            PUBLISHED BY
          </p>
          <p style="margin:0;color:#24143f;font-size:14px;font-weight:bold;">
            ${publishedBy}
          </p>
          ${
            publishedAt
              ? `<p style="margin:6px 0 0;color:#777;font-size:12px;">
                  ${publishedAt}
                </p>`
              : ''
          }
        </td>
      </tr>
    </table>

    ${
      actionUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#d62839"
                style="border-radius:8px;">
                <a href="${actionUrl}"
                  style="display:inline-block;padding:14px 26px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  ${escapeHtml(options.actionLabel ?? 'View announcement')}
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

    <p style="margin:24px 0 0;color:#777;font-size:13px;line-height:1.7;">
      Thank you for staying connected with your community.
    </p>
  `;

  return baseEmailLayout({
    title: `${options.announcementTitle} | ${options.communityName}`,
    preheader: `${options.announcementTitle} — an update from ${options.communityName}.`,
    content,
    footerText:
      options.footerText ??
      `You are receiving this email as a member of ${options.communityName}.`,
  });
}
