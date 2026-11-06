
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export type SecurityAlertType =
  | 'NEW_LOGIN'
  | 'PASSWORD_CHANGED'
  | 'EMAIL_CHANGED'
  | 'SUSPICIOUS_ACTIVITY'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNT_LOCKED';

export interface SecurityAlertOptions {
  recipientName?: string;
  alertType: SecurityAlertType;
  title?: string;
  message: string;
  occurredAt?: string;
  ipAddress?: string;
  device?: string;
  browser?: string;
  location?: string;
  actionLabel?: string;
  actionUrl?: string;
  supportEmail?: string;
  footerText?: string;
}

const ALERT_CONFIG: Record<
  SecurityAlertType,
  {
    label: string;
    color: string;
    background: string;
  }
> = {
  NEW_LOGIN: {
    label: 'NEW SIGN-IN',
    color: '#18794E',
    background: '#EAF7EF',
  },
  PASSWORD_CHANGED: {
    label: 'PASSWORD UPDATED',
    color: '#7137A8',
    background: '#F3ECFA',
  },
  EMAIL_CHANGED: {
    label: 'EMAIL ADDRESS UPDATED',
    color: '#7137A8',
    background: '#F3ECFA',
  },
  SUSPICIOUS_ACTIVITY: {
    label: 'SECURITY NOTICE',
    color: '#B54708',
    background: '#FFF4E5',
  },
  ACCOUNT_UPDATED: {
    label: 'ACCOUNT SECURITY UPDATE',
    color: '#7137A8',
    background: '#F3ECFA',
  },
  ACCOUNT_LOCKED: {
    label: 'ACCOUNT PROTECTION',
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

export function securityAlertTemplate(
  options: SecurityAlertOptions,
): string {
  const {
    recipientName,
    alertType,
    title,
    message,
    occurredAt,
    ipAddress,
    device,
    browser,
    location,
    actionLabel,
    actionUrl,
    supportEmail,
    footerText,
  } = options;

  const config = ALERT_CONFIG[alertType];

  const defaultTitles: Record<SecurityAlertType, string> = {
    NEW_LOGIN: 'New sign-in to your account',
    PASSWORD_CHANGED: 'Your password was changed',
    EMAIL_CHANGED: 'Your email address was changed',
    SUSPICIOUS_ACTIVITY: 'Unusual account activity detected',
    ACCOUNT_UPDATED: 'Your account security settings changed',
    ACCOUNT_LOCKED: 'Your account has been temporarily protected',
  };

  const safeTitle = escapeHtml(title || defaultTitles[alertType]);
  const safeMessage = escapeHtml(message);

  const safeName = recipientName
    ? escapeHtml(recipientName)
    : 'there';

  const formattedDate = formatDate(occurredAt);

  const detailItems: Array<{
    label: string;
    value?: string;
  }> = [
    {
      label: 'Date and time',
      value: formattedDate,
    },
    {
      label: 'Device',
      value: device,
    },
    {
      label: 'Browser',
      value: browser,
    },
    {
      label: 'Location',
      value: location,
    },
    {
      label: 'IP address',
      value: ipAddress,
    },
  ];

  const detailsRows = detailItems
    .filter((item) => item.value?.trim())
    .map(
      (item) => `
        <tr>
          <td style="
            width:38%;
            padding:12px 14px;
            color:#716B7D;
            font-size:12px;
            border-bottom:1px solid #EEEAF2;
          ">
            ${escapeHtml(item.label)}
          </td>

          <td style="
            padding:12px 14px;
            color:#30283D;
            font-size:13px;
            font-weight:600;
            border-bottom:1px solid #EEEAF2;
            word-break:break-word;
          ">
            ${escapeHtml(item.value!)}
          </td>
        </tr>
      `,
    )
    .join('');

  const detailsSection = detailsRows
    ? `
      <h2 style="
        margin:26px 0 12px;
        color:#30283D;
        font-size:15px;
      ">
        Activity details
      </h2>

      <table
        role="presentation"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        style="
          border:1px solid #EEEAF2;
          border-radius:10px;
          border-collapse:separate;
        "
      >
        ${detailsRows}
      </table>
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
                  font-family:Arial,Helvetica,sans-serif;
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
        margin:22px 0 0;
        color:#716B7D;
        font-size:13px;
        line-height:21px;
      ">
        Need assistance? Contact our support team at
        <a
          href="mailto:${escapeHtml(supportEmail)}"
          style="color:#7137A8;text-decoration:none;"
        >
          ${escapeHtml(supportEmail)}
        </a>.
      </p>
    `
    : '';

  const safetyNotice = `
    <div style="
      margin-top:26px;
      padding:16px;
      background:#FFF8E8;
      border:1px solid #F5E5B8;
      border-radius:8px;
    ">
      <strong style="
        display:block;
        margin-bottom:6px;
        color:#805400;
        font-size:13px;
      ">
        Didn't make this change?
      </strong>

      <p style="
        margin:0;
        color:#6B5427;
        font-size:13px;
        line-height:21px;
      ">
        If you don't recognise this activity, review your account
        security and contact AdugboHub support. Never share your
        password or verification codes with anyone.
      </p>
    </div>
  `;

  const content = `
    <div style="
      display:inline-block;
      margin-bottom:22px;
      padding:8px 13px;
      color:${config.color};
      background:${config.background};
      border-radius:20px;
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
      margin:0 0 14px;
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

    ${detailsSection}
    ${actionSection}
    ${safetyNotice}
    ${supportSection}
  `;

  return baseEmailLayout({
    title: safeTitle,
    preheader: safeMessage.slice(0, 120),
    content,
    footerText,
  });
}
