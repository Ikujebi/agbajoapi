
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface ReportSubmittedOptions {
  recipientName?: string;
  reporterName: string;
  reportId: string;
  targetType: string;
  targetId: string;
  reason: string;
  details?: string;
  submittedAt?: Date | string;
  reportUrl?: string;
  footerText?: string;
}

export function reportSubmittedTemplate(
  options: ReportSubmittedOptions,
): string {
  const recipientName = escapeHtml(
    options.recipientName?.trim() || 'Administrator',
  );

  const reporterName = escapeHtml(options.reporterName);
  const reportId = escapeHtml(options.reportId);
  const targetType = escapeHtml(options.targetType);
  const targetId = escapeHtml(options.targetId);
  const reason = escapeHtml(options.reason);

  const details = options.details?.trim()
    ? escapeHtml(options.details.trim()).replace(/\r?\n/g, '<br>')
    : 'No additional details were provided.';

  const submittedAt = options.submittedAt
    ? escapeHtml(
        new Date(options.submittedAt).toLocaleString('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Africa/Lagos',
        }),
      )
    : 'Not available';

  const safeUrl = options.reportUrl?.startsWith('https://')
    ? escapeHtml(options.reportUrl)
    : undefined;

  const actionButton = safeUrl
    ? `
      <p style="margin:28px 0;">
        <a
          href="${safeUrl}"
          style="
            display:inline-block;
            background:#dc2626;
            color:#ffffff;
            padding:13px 22px;
            border-radius:8px;
            text-decoration:none;
            font-weight:700;
          "
        >
          Review report
        </a>
      </p>
    `
    : '';

  const content = `
    <h2 style="margin:0 0 16px;color:#171717;font-size:23px;">
      New report submitted
    </h2>

    <p style="color:#525252;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="color:#525252;line-height:1.7;">
      A new report has been submitted on AdugboHub and requires
      moderation review.
    </p>

    <div style="
      background:#f9fafb;
      border:1px solid #e5e7eb;
      border-radius:10px;
      padding:18px;
      margin:22px 0;
    ">
      <p style="margin:0 0 10px;color:#737373;font-size:12px;">
        REPORT REFERENCE
      </p>

      <p style="margin:0 0 18px;color:#171717;font-weight:700;">
        ${reportId}
      </p>

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        REPORTED ITEM
      </p>

      <p style="margin:0 0 18px;color:#171717;font-weight:600;">
        ${targetType} — ${targetId}
      </p>

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        REPORTED BY
      </p>

      <p style="margin:0 0 18px;color:#171717;">
        ${reporterName}
      </p>

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        REASON
      </p>

      <p style="margin:0 0 18px;color:#171717;">
        ${reason}
      </p>

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        ADDITIONAL DETAILS
      </p>

      <p style="margin:0 0 18px;color:#404040;line-height:1.7;">
        ${details}
      </p>

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        SUBMITTED
      </p>

      <p style="margin:0;color:#171717;">
        ${submittedAt}
      </p>
    </div>

    ${actionButton}

    <p style="color:#737373;font-size:13px;line-height:1.7;">
      Please review the report and take appropriate action in
      accordance with AdugboHub's community guidelines.
    </p>
  `;

  return baseEmailLayout({
    title: 'New report submitted',
    preheader: 'A new report requires your moderation attention.',
    content,
    footerText: options.footerText,
  });
}
