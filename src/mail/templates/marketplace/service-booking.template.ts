import { baseEmailLayout, escapeHtml } from '../layouts/base-layout.template';

export interface ServiceBookingEmailOptions {
  recipientName?: string;
  title: string;
  message: string;
  serviceName: string;
  bookingId: string;
  details?: string[];
}

export function serviceBookingTemplate(
  options: ServiceBookingEmailOptions,
): string {
  const recipientName = escapeHtml(options.recipientName || 'there');
  const title = escapeHtml(options.title);
  const message = escapeHtml(options.message);
  const serviceName = escapeHtml(options.serviceName);
  const bookingId = escapeHtml(options.bookingId);

  const details = (options.details ?? [])
    .map(
      (detail) => `
        <tr>
          <td style="
            padding: 10px 0;
            border-bottom: 1px solid #eeeeee;
            color: #555555;
            font-size: 14px;
            line-height: 22px;
          ">
            ${escapeHtml(detail)}
          </td>
        </tr>
      `,
    )
    .join('');

  const content = `
    <p style="
      margin: 0 0 18px;
      color: #333333;
      font-size: 15px;
      line-height: 25px;
    ">
      Hello ${recipientName},
    </p>

    <p style="
      margin: 0 0 22px;
      color: #444444;
      font-size: 15px;
      line-height: 26px;
    ">
      ${message}
    </p>

    <div style="
      margin: 24px 0;
      padding: 20px;
      background: #faf7ff;
      border: 1px solid #eee5ff;
      border-radius: 12px;
    ">
      <p style="
        margin: 0 0 8px;
        color: #777777;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
      ">
        Service
      </p>

      <p style="
        margin: 0 0 16px;
        color: #29213b;
        font-size: 18px;
        font-weight: bold;
      ">
        ${serviceName}
      </p>

      <p style="
        margin: 0;
        color: #777777;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
      ">
        Booking reference
      </p>

      <p style="
        margin: 6px 0 0;
        color: #29213b;
        font-size: 13px;
        word-break: break-all;
      ">
        ${bookingId}
      </p>
    </div>

    ${
      details.length
        ? `
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            style="border-collapse: collapse; margin: 20px 0;"
          >
            ${details}
          </table>
        `
        : ''
    }

    <p style="
      margin: 24px 0 0;
      color: #777777;
      font-size: 13px;
      line-height: 22px;
    ">
      You can view your booking and its latest status in AdugboHub.
    </p>
  `;

  return baseEmailLayout({
    title,
    preheader: `${title} — ${options.serviceName}`,
    content,
    footerText:
      'You received this email because of activity relating to a service booking on AdugboHub.',
  });
}