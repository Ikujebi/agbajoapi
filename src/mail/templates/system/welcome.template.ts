
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface WelcomeEmailOptions {
  recipientName: string;
  email?: string;
  communityName?: string;
  title?: string;
  message?: string;
  gettingStarted?: string[];
  actionLabel?: string;
  actionUrl?: string;
  supportEmail?: string;
  footerText?: string;
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

export function welcomeTemplate(
  options: WelcomeEmailOptions,
): string {
  const {
    recipientName,
    email,
    communityName,
    title = 'Welcome to AdugboHub!',
    message = 'We are excited to have you join a community where neighbours connect, share information and discover local opportunities.',
    gettingStarted = [
      'Complete your profile so your community can recognise you.',
      'Explore neighbourhood announcements and important updates.',
      'Discover local businesses and services around you.',
      'Connect with neighbours and participate in your community.',
    ],
    actionLabel = 'Explore AdugboHub',
    actionUrl = 'https://adugbohub.com',
    supportEmail,
    footerText,
  } = options;

  const safeName = escapeHtml(recipientName.trim());
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  const safeCommunityName = communityName?.trim()
    ? escapeHtml(communityName.trim())
    : undefined;

  const safeEmail = email?.trim()
    ? escapeHtml(email.trim())
    : undefined;

  const safeActionUrl = safeHttpsUrl(actionUrl);

  const steps = gettingStarted
    .filter((step) => step?.trim())
    .map(
      (step, index) => `
        <tr>
          <td
            valign="top"
            width="38"
            style="padding:0 12px 15px 0;"
          >
            <div style="
              width:28px;
              height:28px;
              line-height:28px;
              text-align:center;
              border-radius:50%;
              background:#F3ECFA;
              color:#7137A8;
              font-size:13px;
              font-weight:700;
            ">
              ${index + 1}
            </div>
          </td>

          <td
            valign="top"
            style="
              padding:4px 0 15px;
              color:#403B50;
              font-size:13px;
              line-height:21px;
            "
          >
            ${escapeHtml(step)}
          </td>
        </tr>
      `,
    )
    .join('');

  const stepsSection = steps
    ? `
      <div style="margin:30px 0;">
        <h2 style="
          margin:0 0 18px;
          color:#30283D;
          font-family:Arial,Helvetica,sans-serif;
          font-size:17px;
          line-height:24px;
        ">
          Here's how to get started
        </h2>

        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
        >
          ${steps}
        </table>
      </div>
    `
    : '';

  const accountSection = safeEmail
    ? `
      <div style="
        margin:22px 0;
        padding:15px 16px;
        background:#F8F6FA;
        border:1px solid #EEEAF2;
        border-radius:8px;
      ">
        <div style="
          margin-bottom:5px;
          color:#716B7D;
          font-size:12px;
        ">
          Registered email address
        </div>

        <div style="
          color:#30283D;
          font-size:14px;
          font-weight:700;
          word-break:break-word;
        ">
          ${safeEmail}
        </div>
      </div>
    `
    : '';

  const communitySection = safeCommunityName
    ? `
      <p style="
        margin:18px 0;
        color:#403B50;
        font-size:14px;
        line-height:23px;
      ">
        You are joining
        <strong>${safeCommunityName}</strong>.
        We look forward to helping you stay connected.
      </p>
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
                  padding:15px 26px;
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
        Have questions? Our support team is available at
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
      padding:24px;
      background:#F8F3FC;
      border-radius:12px;
      text-align:center;
    ">
      <div style="
        margin-bottom:10px;
        color:#7137A8;
        font-size:12px;
        font-weight:700;
        letter-spacing:1.2px;
      ">
        YOU'RE PART OF SOMETHING LOCAL
      </div>

      <h1 style="
        margin:0;
        color:#251B32;
        font-family:Arial,Helvetica,sans-serif;
        font-size:27px;
        line-height:36px;
      ">
        ${safeTitle}
      </h1>
    </div>

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

    ${communitySection}
    ${accountSection}
    ${stepsSection}
    ${actionSection}

    <p style="
      margin:24px 0 0;
      color:#403B50;
      font-size:14px;
      line-height:24px;
    ">
      Thank you for choosing AdugboHub. Together, we can build
      better-connected neighbourhoods.
    </p>

    <p style="
      margin:18px 0 0;
      color:#403B50;
      font-size:14px;
      line-height:23px;
    ">
      Welcome aboard,<br />
      <strong>The AdugboHub Team</strong>
    </p>

    ${supportSection}
  `;

  return baseEmailLayout({
    title: safeTitle,
    preheader:
      `Welcome to AdugboHub, ${recipientName.trim()}!`,
    content,
    footerText,
  });
}
