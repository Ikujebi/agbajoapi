
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export type SosEmailEvent =
  | 'ALERT'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'CANCELLED';

export interface SosEmailOptions {
  recipientName?: string;
  organizationName: string;
  alertId: string;
  event: SosEmailEvent;
  residentName?: string;
  eventAt?: Date | string;
  footerText?: string;
}

const eventContent: Record<
  SosEmailEvent,
  { title: string; message: string; color: string; background: string }
> = {
  ALERT: {
    title: 'New SOS emergency alert',
    message:
      'A resident has triggered an SOS alert in your estate. Please check the authenticated responder interface and follow your emergency response procedure.',
    color: '#b91c1c',
    background: '#fef2f2',
  },
  ACKNOWLEDGED: {
    title: 'Your SOS has been acknowledged',
    message:
      'An estate responder has acknowledged your SOS alert. Please remain available and follow any instructions provided by the responder.',
    color: '#1d4ed8',
    background: '#eff6ff',
  },
  RESOLVED: {
    title: 'Your SOS alert has been resolved',
    message:
      'Your SOS alert has been marked as resolved by an authorized estate responder. If you still need assistance, contact your estate security team directly.',
    color: '#15803d',
    background: '#f0fdf4',
  },
  CANCELLED: {
    title: 'SOS alert cancelled',
    message:
      'The resident who raised this SOS alert has cancelled it. Please check the responder interface for the latest alert status.',
    color: '#a16207',
    background: '#fefce8',
  },
};

export function sosEventTemplate(options: SosEmailOptions): string {
  const event = eventContent[options.event];

  const greeting = options.recipientName
    ? `Hello ${escapeHtml(options.recipientName)},`
    : 'Hello,';

  const eventDate = options.eventAt
    ? new Date(options.eventAt).toLocaleString('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Just now';

  const resident = options.residentName
    ? `
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;width:38%;border-bottom:1px solid #e2e8f0;">
          Resident
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(options.residentName)}
        </td>
      </tr>
    `
    : '';

  const content = `
    <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
      ${greeting}
    </p>

    <div style="padding:18px;background:${event.background};border-radius:12px;margin-bottom:20px;">
      <p style="margin:0;color:${event.color};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">
        ${escapeHtml(event.title)}
      </p>
      <p style="margin:10px 0 0;color:#334155;font-size:14px;line-height:1.7;">
        ${escapeHtml(event.message)}
      </p>
    </div>

    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;width:38%;border-bottom:1px solid #e2e8f0;">
          Estate
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(options.organizationName)}
        </td>
      </tr>
      ${resident}
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">
          Alert reference
        </td>
        <td style="padding:12px 0;color:#334155;font-size:12px;word-break:break-all;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(options.alertId)}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;">
          Time
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;">
          ${escapeHtml(eventDate)}
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.6;">
      This is an automatic safety notification from AdugboHub.
      Email is not a substitute for contacting emergency services.
    </p>
  `;

  return baseEmailLayout({
    title: event.title,
    preheader: `${event.title} — ${options.organizationName}`,
    content,
    footerText: options.footerText,
  });
}
