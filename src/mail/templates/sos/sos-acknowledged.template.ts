import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface SosAcknowledgedEmailOptions {
  recipientName?: string;
  organizationName: string;
  alertId: string;
  eventAt?: Date | string;
  footerText?: string;
}

export function sosAcknowledgedTemplate(
  options: SosAcknowledgedEmailOptions,
): string {
  const recipientName = escapeHtml(
    options.recipientName || 'Resident',
  );

  const organizationName = escapeHtml(options.organizationName);
  const alertId = escapeHtml(options.alertId);

  const eventAt = options.eventAt
    ? escapeHtml(new Date(options.eventAt).toLocaleString())
    : 'Just now';

  const content = `
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">
      Hello ${recipientName},
    </p>

    <div style="
      background:#eff6ff;
      border:1px solid #bfdbfe;
      border-radius:12px;
      padding:20px;
      margin:20px 0;
    ">
      <h2 style="
        margin:0 0 10px;
        color:#1d4ed8;
        font-size:20px;
      ">
        Your SOS Alert Has Been Acknowledged
      </h2>

      <p style="margin:0;color:#1e40af;font-size:14px;line-height:1.7;">
        Your emergency alert in
        <strong>${organizationName}</strong>
        has been acknowledged by a community responder.
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
          Acknowledged
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #e5e7eb;">
          ${eventAt}
        </td>
      </tr>
    </table>

    <p style="margin:20px 0 0;color:#4b5563;font-size:14px;line-height:1.7;">
      Acknowledgement does not necessarily mean assistance has arrived.
      If you are still in danger or need immediate help, contact the
      appropriate emergency services directly.
    </p>
  `;

  return baseEmailLayout({
    title: 'SOS Alert Acknowledged',
    preheader: 'Your community responder has acknowledged your SOS alert.',
    content,
    footerText: options.footerText,
  });
}