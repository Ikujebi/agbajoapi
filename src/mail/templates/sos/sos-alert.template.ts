import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface SosAlertEmailOptions {
  recipientName?: string;
  organizationName: string;
  alertId: string;
  residentName: string;
  eventAt?: Date | string;
  footerText?: string;
}

export function sosAlertTemplate(
  options: SosAlertEmailOptions,
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
      background:#fff1f2;
      border:1px solid #fecdd3;
      border-radius:12px;
      padding:20px;
      margin:20px 0;
    ">
      <h2 style="
        margin:0 0 10px;
        color:#be123c;
        font-size:20px;
      ">
        Emergency SOS Alert
      </h2>

      <p style="margin:0;color:#881337;font-size:14px;line-height:1.7;">
        A resident has triggered an SOS alert in
        <strong>${organizationName}</strong>.
        Please open AdugboHub and check the alert immediately.
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
          Triggered
        </td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #e5e7eb;">
          ${eventAt}
        </td>
      </tr>
    </table>

    <p style="margin:20px 0 0;color:#4b5563;font-size:14px;line-height:1.7;">
      Please use the AdugboHub application to view the alert and coordinate
      an appropriate response. Do not rely on email as the primary emergency
      notification channel.
    </p>
  `;

  return baseEmailLayout({
    title: 'Emergency SOS Alert',
    preheader: `A resident has triggered an SOS alert in ${organizationName}.`,
    content,
    footerText: options.footerText,
  });
}