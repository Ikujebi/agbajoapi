
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface ReportUpdateOptions {
  recipientName?: string;
  reportId: string;
  targetType: string;
  targetId: string;
  outcome: 'ACTIONED' | 'DISMISSED';
  resolutionNote?: string;
  resolvedAt?: Date | string;
  reportUrl?: string;
  footerText?: string;
}

export function reportUpdateTemplate(
  options: ReportUpdateOptions,
): string {
  const recipientName = escapeHtml(
    options.recipientName?.trim() || 'there',
  );

  const reportId = escapeHtml(options.reportId);
  const targetType = escapeHtml(options.targetType);
  const targetId = escapeHtml(options.targetId);

  const actionTaken = options.outcome === 'ACTIONED';

  const heading = actionTaken
    ? 'Your report has been reviewed'
    : 'Your report has been closed';

  const message = actionTaken
    ? 'Thank you for bringing this matter to our attention. Our moderation team reviewed the report and has taken action.'
    : 'Thank you for bringing this matter to our attention. Our moderation team reviewed the report and did not find a violation requiring action.';

  const resolutionNote = options.resolutionNote?.trim()
    ? escapeHtml(options.resolutionNote.trim()).replace(/\r?\n/g, '<br>')
    : undefined;

  const resolvedAt = options.resolvedAt
    ? escapeHtml(
        new Date(options.resolvedAt).toLocaleString('en-NG', {
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
          View report
        </a>
      </p>
    `
    : '';

  const content = `
    <h2 style="margin:0 0 16px;color:#171717;font-size:23px;">
      ${heading}
    </h2>

    <p style="color:#525252;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="color:#525252;line-height:1.7;">
      ${message}
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

      <p style="margin:0 0 18px;color:#171717;">
        ${targetType} — ${targetId}
      </p>

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        OUTCOME
      </p>

      <p style="
        margin:0 0 18px;
        color:${actionTaken ? '#15803d' : '#525252'};
        font-weight:700;
      ">
        ${actionTaken ? 'Action taken' : 'Dismissed'}
      </p>

      ${
        resolutionNote
          ? `
            <p style="margin:0 0 6px;color:#737373;font-size:12px;">
              MODERATION NOTE
            </p>

            <p style="margin:0 0 18px;color:#404040;line-height:1.7;">
              ${resolutionNote}
            </p>
          `
          : ''
      }

      <p style="margin:0 0 6px;color:#737373;font-size:12px;">
        RESOLVED
      </p>

      <p style="margin:0;color:#171717;">
        ${resolvedAt}
      </p>
    </div>

    ${actionButton}

    <p style="color:#737373;font-size:13px;line-height:1.7;">
      We appreciate your contribution to keeping the AdugboHub
      community safe and welcoming.
    </p>
  `;

  return baseEmailLayout({
    title: heading,
    preheader: 'There is an update on your AdugboHub report.',
    content,
    footerText: options.footerText,
  });
}
