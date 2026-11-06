
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export type MaintenanceStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DELAYED';

export interface MaintenanceNoticeOptions {
  recipientName?: string;
  title?: string;
  message: string;
  status?: MaintenanceStatus;
  scheduledStart?: string;
  scheduledEnd?: string;
  affectedServices?: string[];
  impact?: string;
  actionLabel?: string;
  actionUrl?: string;
  supportEmail?: string;
  footerText?: string;
}

const STATUS_CONFIG: Record<
  MaintenanceStatus,
  {
    label: string;
    color: string;
    background: string;
  }
> = {
  SCHEDULED: {
    label: 'Scheduled maintenance',
    color: '#7137A8',
    background: '#F3ECFA',
  },
  IN_PROGRESS: {
    label: 'Maintenance in progress',
    color: '#B54708',
    background: '#FFF4E5',
  },
  COMPLETED: {
    label: 'Maintenance completed',
    color: '#18794E',
    background: '#EAF7EF',
  },
  DELAYED: {
    label: 'Maintenance delayed',
    color: '#B42318',
    background: '#FEECEB',
  },
};

function safeHttpsUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);

    return url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

export function maintenanceNoticeTemplate(
  options: MaintenanceNoticeOptions,
): string {
  const {
    recipientName,
    title = 'Scheduled platform maintenance',
    message,
    status = 'SCHEDULED',
    scheduledStart,
    scheduledEnd,
    affectedServices = [],
    impact,
    actionLabel,
    actionUrl,
    supportEmail,
    footerText,
  } = options;

  const config = STATUS_CONFIG[status];

  const safeName = recipientName
    ? escapeHtml(recipientName)
    : 'there';

  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  const start = formatDate(scheduledStart);
  const end = formatDate(scheduledEnd);

  const safeServices = affectedServices
    .filter((service) => service?.trim())
    .map(
      (service) => `
        <li style="
          margin:0 0 8px;
          padding-left:4px;
          color:#403B50;
          font-size:13px;
          line-height:21px;
        ">
          ${escapeHtml(service)}
        </li>
      `,
    )
    .join('');

  const scheduleSection =
    start || end
      ? `
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          style="
            margin:22px 0;
            border:1px solid #EEEAF2;
            border-radius:10px;
          "
        >
          ${
            start
              ? `
                <tr>
                  <td style="padding:13px 16px;">
                    <div style="
                      color:#716B7D;
                      font-size:12px;
                      margin-bottom:5px;
                    ">
                      Expected start
                    </div>
                    <div style="
                      color:#30283D;
                      font-size:14px;
                      font-weight:700;
                    ">
                      ${escapeHtml(start)}
                    </div>
                  </td>
                </tr>
              `
              : ''
          }

          ${
            end
              ? `
                <tr>
                  <td style="
                    padding:13px 16px;
                    border-top:1px solid #EEEAF2;
                  ">
                    <div style="
                      color:#716B7D;
                      font-size:12px;
                      margin-bottom:5px;
                    ">
                      Expected completion
                    </div>
                    <div style="
                      color:#30283D;
                      font-size:14px;
                      font-weight:700;
                    ">
                      ${escapeHtml(end)}
                    </div>
                  </td>
                </tr>
              `
              : ''
          }
        </table>
      `
      : '';

  const servicesSection = safeServices
    ? `
      <div style="margin:24px 0;">
        <h2 style="
          margin:0 0 12px;
          color:#30283D;
          font-size:15px;
        ">
          Affected services
        </h2>

        <ul style="
          margin:0;
          padding-left:20px;
        ">
          ${safeServices}
        </ul>
      </div>
    `
    : '';

  const impactSection = impact?.trim()
    ? `
      <div style="
        margin:22px 0;
        padding:15px 16px;
        background:#F8F6FA;
        border-left:4px solid #7137A8;
        border-radius:6px;
      ">
        <strong style="
          display:block;
          margin-bottom:6px;
          color:#30283D;
          font-size:13px;
        ">
          Expected impact
        </strong>

        <p style="
          margin:0;
          color:#514A60;
          font-size:13px;
          line-height:22px;
        ">
          ${escapeHtml(impact)}
        </p>
      </div>
    `
    : '';

  const safeActionUrl = safeHttpsUrl(actionUrl);

  const actionSection =
    actionLabel && safeActionUrl
      ? `
        <table
          role="presentation"
          cellpadding="0"
          cellspacing="0"
          style="margin:26px 0;"
        >
          <tr>
            <td
              bgcolor="#7137A8"
              style="border-radius:8px;"
            >
              <a
                href="${escapeHtml(safeActionUrl)}"
                style="
                  display:inline-block;
                  padding:14px 24px;
                  color:#FFFFFF;
                  font-size:14px;
                  font-weight:700;
                  text-decoration:none;
                  border-radius:8px;
                "
              >
                ${escapeHtml(actionLabel)}
              </a>
            </td>
          </tr>
        </table>
      `
      : '';

  const supportSection = supportEmail
    ? `
      <p style="
        margin:24px 0 0;
        color:#716B7D;
        font-size:13px;
        line-height:21px;
      ">
        If you need assistance, contact
        <a
          href="mailto:${escapeHtml(supportEmail)}"
          style="color:#7137A8;text-decoration:none;"
        >
          ${escapeHtml(supportEmail)}
        </a>.
      </p>
    `
    : '';

  const content = `
    <div style="
      display:inline-block;
      margin-bottom:22px;
      padding:8px 13px;
      border-radius:20px;
      color:${config.color};
      background:${config.background};
      font-size:11px;
      font-weight:700;
      letter-spacing:0.5px;
    ">
      ${config.label}
    </div>

    <h1 style="
      margin:0 0 16px;
      color:#251B32;
      font-family:Arial,Helvetica,sans-serif;
      font-size:25px;
      line-height:34px;
    ">
      ${safeTitle}
    </h1>

    <p style="
      margin:0 0 16px;
      color:#403B50;
      font-size:14px;
      line-height:24px;
    ">
      Hello ${safeName},
    </p>

    <p style="
      margin:0;
      color:#403B50;
      font-size:14px;
      line-height:24px;
    ">
      ${safeMessage}
    </p>

    ${scheduleSection}
    ${servicesSection}
    ${impactSection}
    ${actionSection}
    ${supportSection}
  `;

  return baseEmailLayout({
    title: safeTitle,
    preheader: safeMessage.slice(0, 120),
    content,
    footerText,
  });
}
