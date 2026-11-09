import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface SosResolvedEmailOptions {
  recipientName?: string;
  organizationName: string;
  alertId: string;
  eventAt?: Date | string;
  resolutionNote?: string;
  footerText?: string;
}

export function sosResolvedTemplate(
  options: SosResolvedEmailOptions,
): string {
  const recipientName = escapeHtml(
    options.recipientName || 'Resident',
  );

  const organizationName = escapeHtml(options.organizationName);
  const alertId = escapeHtml(options.alertId);

  const eventAt = options.eventAt
    ? escapeHtml(new Date(options.eventAt).toLocaleString())
    : 'Just now';

  const resolutionNote = options.resolutionNote
    ? `
      <div style="
        background:#f9fafb;
        border:1px solid #e5e7eb;
        border-radius:10px;
        padding:16px;
        margin:20px 0;
      ">
        <p style="margin:0 0 8px;color:#6b7280;font-size:12px;font-weight:700;">
          RESOLUTION NOTE
        </p>

        <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">
          ${escapeHtml(options.resolutionNote)}
        </p>
      </div>
    `
    : '';

  const content = `
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">
      Hello ${recipientName},
    </p>

    <div style="
      background:#f0fdf4;
      border:1px solid #bbf7d0;
      border-radius:12px;
      padding:20px;
      margin:20px 0;
    ">
      <h2 style="
        margin:0 0 10px;
        color:#15803d;
        font-size:20px;
      ">
        Your SOS Alert Has Been Resolved
      </h2>

      <p style="margin:0;color:#166534;font-size:14px;line-height:1.7;">
        Your SOS alert in
        <strong>${organizationName}</strong>
        has been marked as resolved by a community responder.
      </p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;margin:20px 0;">
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:13px;">
          Community
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;">
          <strong>${organizationName}</strong>
        </td>
      </tr>

      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;">
          Alert ID
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #e5e7eb;">
          ${alertId}
        </td>
      </tr>

      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;">
          Resolved
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #e5e7eb;">
          ${eventAt}
        </td>
      </tr>
    </table>

    ${resolutionNote}

    <p style="margin:20px 0 0;color:#4b5563;font-size:14px;line-height:1.7;">
      If you still require assistance, please contact your community
      responders or the appropriate emergency services directly.
    </p>
  `;

  return baseEmailLayout({
    title: 'SOS Alert Resolved',
    preheader: 'Your SOS alert has been marked as resolved.',
    content,
    footerText: options.footerText,
  });
}