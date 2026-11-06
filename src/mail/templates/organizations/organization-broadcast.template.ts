import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrganizationBroadcastOptions {
  recipientName?: string;
  organizationName: string;
  subject: string;
  message: string;
  senderName?: string;
  sentAt?: string;
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

export function organizationBroadcastTemplate(
  options: OrganizationBroadcastOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const organization = escapeHtml(options.organizationName);
  const subject = escapeHtml(options.subject);
  const actionUrl = safeUrl(options.actionUrl);

  const content = `
    <p style="margin:0 0 18px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, you have a message from <strong>${organization}</strong>.
    </p>

    <div style="padding:20px;background:#f8f7fb;border-radius:12px;margin-bottom:22px;">
      <p style="margin:0 0 8px;color:#a91e3b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
        Organization message
      </p>
      <h2 style="margin:0;color:#24243a;font-size:21px;line-height:1.4;">
        ${subject}
      </h2>
      ${
        options.senderName || options.sentAt
          ? `<p style="margin:10px 0 0;color:#88889a;font-size:12px;">
              ${options.senderName ? `From ${escapeHtml(options.senderName)}` : ''}
              ${options.senderName && options.sentAt ? ' · ' : ''}
              ${options.sentAt ? escapeHtml(options.sentAt) : ''}
            </p>`
          : ''
      }
    </div>

    ${formatMessage(options.message)}

    ${
      actionUrl
        ? `<p style="margin:26px 0 0;">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              ${escapeHtml(options.actionLabel || 'View details')}
            </a>
          </p>`
        : ''
    }

    <p style="margin:24px 0 0;color:#88889a;font-size:12px;line-height:1.6;">
      This message was sent to you as a member of ${organization}.
    </p>
  `;

  return baseEmailLayout({
    title: options.subject,
    preheader: `A message from ${options.organizationName}.`,
    content,
    footerText: options.footerText,
  });
}