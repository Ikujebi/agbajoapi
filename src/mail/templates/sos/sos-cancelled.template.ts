import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface SosCancelledEmailOptions {
  recipientName?: string;
  organizationName: string;
  alertId: string;
  residentName: string;
  eventAt?: Date | string;
  footerText?: string;
}

export function sosCancelledTemplate(
  options: SosCancelledEmailOptions,
): string {
  const recipientName = escapeHtml(
    options.recipientName || 'Responder',
  );

  const organizationName = escapeHtml(options.organizationName);
  const residentName = escapeHtml(options.residentName);
  const alertId = escapeHtml(options.alertId);

  const eventAt = options.eventAt
    ? escapeHtml(new Date(options.eventAt).toLocaleString())
    : 'Just now';

  const content = `
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">
      Hello ${recipientName},
    </p>

    <div style="
      background:#f9fafb;
      border:1px solid #e5e7eb;
      border-radius:12px;
      padding:20px;
      margin:20px 0;
    ">
      <h2 style="
        margin:0 0 10px;
        color:#374151;
        font-size:20px;
      ">
        SOS Alert Cancelled
      </h2>

      <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.7;">
        An SOS alert previously triggered in
        <strong>${organizationName}</strong>
        has been cancelled by the resident.
      </p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;margin:20px 0;">
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:13px;">
          Resident
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;">
          <strong>${residentName}</strong>
        </td>
      </tr>

      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:13px;border-top:1px solid #e5e7eb;">
          Community
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #e5e7eb;">
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
          Cancelled
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #e5e7eb;">
          ${eventAt}
        </td>
      </tr>
    </table>

    <p style="margin:20px 0 0;color:#4b5563;font-size:14px;line-height:1.7;">
      Please check the AdugboHub application for the latest alert status.
      If you have already started responding, follow your community's
      established safety procedures.
    </p>
  `;

  return baseEmailLayout({
    title: 'SOS Alert Cancelled',
    preheader: `An SOS alert in ${organizationName} has been cancelled.`,
    content,
    footerText: options.footerText,
  });
}