
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface AccountNotificationOptions {
  recipientName?: string;
  title: string;
  message: string;
  eventLabel?: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
  actionLabel?: string;
  actionUrl?: string;
  footerText?: string;
  supportEmail?: string;
}

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

export function accountNotificationTemplate(
  options: AccountNotificationOptions,
): string {
  const {
    recipientName,
    title,
    message,
    eventLabel = 'ACCOUNT NOTIFICATION',
    details = [],
    actionLabel,
    actionUrl,
    footerText,
    supportEmail,
  } = options;

  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeName = recipientName
    ? escapeHtml(recipientName)
    : 'there';

  const safeEventLabel = escapeHtml(eventLabel);
  const safeActionUrl = safeHttpsUrl(actionUrl);

  const safeDetails = details
    .filter(
      (item) =>
        item.label?.trim() &&
        item.value?.trim(),
    )
    .map(
      (item) => `
        <tr>
          <td style="
            padding:12px 14px;
            color:#716B7D;
            font-size:13px;
            border-bottom:1px solid #EEEAF2;
            width:40%;
          ">
            ${escapeHtml(item.label)}
          </td>
          <td style="
            padding:12px 14px;
            color:#30283D;
            font-size:13px;
            font-weight:600;
            border-bottom:1px solid #EEEAF2;
          ">
            ${escapeHtml(item.value)}
          </td>
        </tr>
      `,
    )
    .join('');

  const detailsSection = safeDetails
    ? `
      <table
        role="presentation"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        style="
          margin:24px 0;
          border:1px solid #EEEAF2;
          border-radius:10px;
          border-collapse:separate;
          overflow:hidden;
        "
      >
        ${safeDetails}
      </table>
    `
    : '';

  const actionSection =
    actionLabel && safeActionUrl
      ? `
        <table
          role="presentation"
          cellpadding="0"
          cellspacing="0"
          style="margin:28px 0;"
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
        margin:24px 0 0;
        color:#716B7D;
        font-size:13px;
        line-height:21px;
      ">
        Need help? Contact us at
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
      margin-bottom:24px;
      padding:8px 12px;
      display:inline-block;
      background:#F3ECFA;
      color:#7137A8;
      border-radius:20px;
      font-size:11px;
      font-weight:700;
      letter-spacing:0.8px;
    ">
      ${safeEventLabel}
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

    ${supportSection}
  `;

  return baseEmailLayout({
    title: safeTitle,
    preheader: safeMessage.slice(0, 120),
    content,
    footerText,
  });
}
