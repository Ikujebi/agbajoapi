import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface EventAnnouncementEmailOptions {
  recipientName?: string;
  eventTitle: string;
  eventDescription?: string;
  organizationName?: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  eventUrl?: string;
}

function safeEventUrl(value?: string): string | undefined {
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

export function eventAnnouncementTemplate(
  options: EventAnnouncementEmailOptions,
): string {
  const {
    recipientName,
    eventTitle,
    eventDescription,
    organizationName,
    startsAt,
    endsAt,
    location,
    eventUrl,
  } = options;

  const safeName = recipientName
    ? escapeHtml(recipientName)
    : 'there';

  const safeTitle = escapeHtml(eventTitle);
  const safeDescription = eventDescription
    ? escapeHtml(eventDescription)
    : '';

  const safeOrganization = organizationName
    ? escapeHtml(organizationName)
    : 'Your community';

  const safeStartsAt = escapeHtml(startsAt);
  const safeEndsAt = endsAt
    ? escapeHtml(endsAt)
    : '';

  const safeLocation = location
    ? escapeHtml(location)
    : 'To be announced';

  const safeLink = safeEventUrl(eventUrl);

  const descriptionSection = safeDescription
    ? `
      <p style="
        margin:0 0 24px;
        color:#777487;
        font-size:15px;
        line-height:1.8;
      ">
        ${safeDescription}
      </p>
    `
    : '';

  const endDateSection = safeEndsAt
    ? `
      <tr>
        <td style="
          padding:10px 0;
          color:#777487;
          width:110px;
          vertical-align:top;
        ">
          Ends
        </td>
        <td style="
          padding:10px 0;
          color:#252238;
          font-weight:bold;
        ">
          ${safeEndsAt}
        </td>
      </tr>
    `
    : '';

  const actionSection = safeLink
    ? `
      <table
        role="presentation"
        cellpadding="0"
        cellspacing="0"
        border="0"
        style="margin-top:28px;"
      >
        <tr>
          <td
            align="center"
            bgcolor="#D92D45"
            style="border-radius:8px;"
          >
            <a
              href="${escapeHtml(safeLink)}"
              target="_blank"
              style="
                display:inline-block;
                padding:14px 24px;
                color:#FFFFFF;
                font-size:14px;
                font-weight:bold;
                text-decoration:none;
                border-radius:8px;
              "
            >
              View event details
            </a>
          </td>
        </tr>
      </table>
    `
    : '';

  const content = `
    <p style="
      margin:0 0 12px;
      color:#252238;
      font-size:16px;
    ">
      Hello ${safeName},
    </p>

    <h1 style="
      margin:0 0 12px;
      color:#252238;
      font-size:25px;
      line-height:1.35;
    ">
      There's something happening in your community!
    </h1>

    <p style="
      margin:0 0 24px;
      color:#777487;
      font-size:15px;
      line-height:1.8;
    ">
      ${safeOrganization} has published a new event.
      We'd love you to be part of it.
    </p>

    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="
        background:#FAF8FC;
        border:1px solid #E9E7EF;
        border-radius:12px;
      "
    >
      <tr>
        <td style="padding:22px;">
          <p style="
            margin:0 0 8px;
            color:#7137A8;
            font-size:12px;
            font-weight:bold;
            text-transform:uppercase;
            letter-spacing:1px;
          ">
            Community event
          </p>

          <h2 style="
            margin:0 0 16px;
            color:#252238;
            font-size:21px;
            line-height:1.4;
          ">
            ${safeTitle}
          </h2>

          ${descriptionSection}

          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="
              border-top:1px solid #E9E7EF;
              font-size:14px;
              line-height:1.6;
            "
          >
            <tr>
              <td style="
                padding:12px 0;
                color:#777487;
                width:110px;
                vertical-align:top;
              ">
                Starts
              </td>
              <td style="
                padding:12px 0;
                color:#252238;
                font-weight:bold;
              ">
                ${safeStartsAt}
              </td>
            </tr>

            ${endDateSection}

            <tr>
              <td style="
                padding:10px 0;
                color:#777487;
                width:110px;
                vertical-align:top;
              ">
                Location
              </td>
              <td style="
                padding:10px 0;
                color:#252238;
                font-weight:bold;
              ">
                ${safeLocation}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${actionSection}

    <p style="
      margin:28px 0 0;
      color:#777487;
      font-size:14px;
      line-height:1.8;
    ">
      Stay connected, get involved, and make your neighbourhood
      an even better place to live.
    </p>
  `;

  return baseEmailLayout({
    title: `New community event: ${eventTitle}`,
    preheader: `${eventTitle} — a new event in your community.`,
    content,
  });
}