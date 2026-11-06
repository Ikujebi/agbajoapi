import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrganizationAnnouncementOptions {
  recipientName?: string;
  organizationName: string;
  announcementTitle: string;
  message: string;
  category?: string;
  publishedBy?: string;
  publishedAt?: string;
  actionLabel?: string;
  actionUrl?: string;
  footerText?: string;
}

function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatMessage(value: string): string {
  return value
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;color:#454559;font-size:14px;line-height:1.8;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export function organizationAnnouncementTemplate(
  options: OrganizationAnnouncementOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const organization = escapeHtml(options.organizationName);
  const title = escapeHtml(options.announcementTitle);
  const actionUrl = safeUrl(options.actionUrl);

  const content = `
    <p style="margin:0 0 18px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, here's an update from <strong>${organization}</strong>.
    </p>

    <div style="padding:20px;background:#f8f7fb;border-radius:12px;margin-bottom:22px;">
      ${
        options.category
          ? `<span style="display:inline-block;margin-bottom:12px;padding:5px 10px;background:#fcecef;color:#a91e3b;border-radius:20px;font-size:11px;font-weight:700;">${escapeHtml(options.category)}</span>`
          : ''
      }
      <h2 style="margin:0;color:#24243a;font-size:21px;line-height:1.4;">
        ${title}
      </h2>
      ${
        options.publishedBy || options.publishedAt
          ? `<p style="margin:10px 0 0;color:#88889a;font-size:12px;">
              ${options.publishedBy ? `Published by ${escapeHtml(options.publishedBy)}` : ''}
              ${options.publishedBy && options.publishedAt ? ' · ' : ''}
              ${options.publishedAt ? escapeHtml(options.publishedAt) : ''}
            </p>`
          : ''
      }
    </div>

    ${formatMessage(options.message)}

    ${
      actionUrl
        ? `<p style="margin:26px 0 0;">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              ${escapeHtml(options.actionLabel || 'Read more')}
            </a>
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: options.announcementTitle,
    preheader: `${options.organizationName} has published an announcement.`,
    content,
    footerText: options.footerText,
  });
}