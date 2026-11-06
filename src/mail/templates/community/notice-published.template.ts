import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface NoticePublishedEmailOptions {
  recipientName?: string;
  organizationName: string;
  noticeTitle: string;
  noticeBody: string;
}

export function noticePublishedTemplate(
  options: NoticePublishedEmailOptions,
): string {
  const greeting = options.recipientName?.trim()
    ? `Hello ${escapeHtml(options.recipientName)},`
    : 'Hello,';

  return baseEmailLayout({
    title: 'New community notice',
    preheader: `A new notice has been published in ${options.organizationName}.`,
    content: `
      <h2 style="margin:0 0 18px;color:#252238;font-size:23px;">
        New community notice
      </h2>

      <p>${greeting}</p>

      <p>
        A new notice has been published in
        <strong>${escapeHtml(options.organizationName)}</strong>.
      </p>

      <div style="margin:24px 0;padding:20px;background:#f8f5ff;border-radius:12px;">
        <h3 style="margin:0 0 12px;color:#252238;">
          ${escapeHtml(options.noticeTitle)}
        </h3>

        <p style="margin:0;color:#555;line-height:1.7;">
          ${escapeHtml(options.noticeBody).replace(/\r?\n/g, '<br>')}
        </p>
      </div>

      <p>Sign in to AdugboHub to stay informed about your community.</p>
    `,
  });
}