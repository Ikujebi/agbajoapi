import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface EventUpdatedEmailOptions {
  recipientName?: string;
  eventName: string;
  communityName?: string;
  updateMessage?: string;
  eventDate?: string;
  eventTime?: string;
  venue?: string;
  eventUrl?: string;
  footerText?: string;
}

function validateHttpsUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') {
      throw new Error('URL must use HTTPS.');
    }

    return escapeHtml(url.toString());
  } catch {
    throw new Error('A valid HTTPS event URL is required.');
  }
}

export function eventUpdatedTemplate(
  options: EventUpdatedEmailOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const eventName = escapeHtml(options.eventName);

  const communityName = options.communityName
    ? escapeHtml(options.communityName)
    : undefined;

  const updateMessage = options.updateMessage
    ? escapeHtml(options.updateMessage)
    : undefined;

  const eventDate = options.eventDate
    ? escapeHtml(options.eventDate)
    : undefined;

  const eventTime = options.eventTime
    ? escapeHtml(options.eventTime)
    : undefined;

  const venue = options.venue
    ? escapeHtml(options.venue)
    : undefined;

  const eventUrl = options.eventUrl
    ? validateHttpsUrl(options.eventUrl)
    : undefined;

  const hasEventDetails = eventDate || eventTime || venue;

  const content = `
    <div style="margin:0 0 20px;">
      <span style="
        display:inline-block;
        padding:6px 12px;
        background:#fff4e5;
        color:#9a6700;
        border-radius:20px;
        font-size:12px;
        font-weight:bold;
      ">
        EVENT UPDATE
      </span>
    </div>

    <h2 style="
      margin:0 0 16px;
      color:#24143f;
      font-size:24px;
      line-height:1.4;
    ">
      There's an update to your event
    </h2>

    <p style="
      margin:0 0 16px;
      color:#555;
      font-size:15px;
      line-height:1.7;
    ">
      Hello ${recipientName},
    </p>

    <p style="
      margin:0 0 24px;
      color:#555;
      font-size:15px;
      line-height:1.8;
    ">
      ${
        communityName
          ? `${communityName} has updated `
          : 'The organizer has updated '
      }
      the details for <strong>${eventName}</strong>.
      Please review the latest information below.
    </p>

    ${
      updateMessage
        ? `<div style="
            margin:0 0 24px;
            padding:18px;
            background:#f8f6fb;
            border-left:4px solid #6b3fa0;
            border-radius:6px;
          ">
            <p style="
              margin:0 0 8px;
              color:#6b3fa0;
              font-size:12px;
              font-weight:bold;
            ">
              WHAT HAS CHANGED?
            </p>

            <p style="
              margin:0;
              color:#555;
              font-size:14px;
              line-height:1.8;
            ">
              ${updateMessage}
            </p>
          </div>`
        : ''
    }

    ${
      hasEventDetails
        ? `<table
            role="presentation"
            cellspacing="0"
            cellpadding="0"
            border="0"
            width="100%"
            style="
              margin:0 0 24px;
              background:#f8f6fb;
              border-radius:10px;
            "
          >
            <tr>
              <td style="padding:20px;">

                <p style="margin:0 0 6px;color:#777;font-size:12px;">
                  EVENT
                </p>

                <p style="
                  margin:0 0 20px;
                  color:#24143f;
                  font-size:16px;
                  font-weight:bold;
                ">
                  ${eventName}
                </p>

                ${
                  eventDate
                    ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                        UPDATED DATE
                      </p>
                      <p style="
                        margin:0 0 16px;
                        color:#24143f;
                        font-size:14px;
                        font-weight:bold;
                      ">
                        ${eventDate}
                      </p>`
                    : ''
                }

                ${
                  eventTime
                    ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                        UPDATED TIME
                      </p>
                      <p style="
                        margin:0 0 16px;
                        color:#24143f;
                        font-size:14px;
                      ">
                        ${eventTime}
                      </p>`
                    : ''
                }

                ${
                  venue
                    ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">
                        UPDATED VENUE
                      </p>
                      <p style="
                        margin:0;
                        color:#24143f;
                        font-size:14px;
                      ">
                        ${venue}
                      </p>`
                    : ''
                }

              </td>
            </tr>
          </table>`
        : ''
    }

    ${
      eventUrl
        ? `<table
            role="presentation"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="margin:24px 0;"
          >
            <tr>
              <td
                align="center"
                bgcolor="#6b3fa0"
                style="border-radius:8px;"
              >
                <a
                  href="${eventUrl}"
                  target="_blank"
                  style="
                    display:inline-block;
                    padding:14px 26px;
                    color:#ffffff;
                    font-size:14px;
                    font-weight:bold;
                    text-decoration:none;
                    border-radius:8px;
                  "
                >
                  View updated event
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

    <p style="
      margin:0;
      color:#666;
      font-size:14px;
      line-height:1.8;
    ">
      Thank you for staying connected with your community.
      We look forward to seeing you at the event!
    </p>
  `;

  return baseEmailLayout({
    title: `Event updated: ${options.eventName}`,
    preheader: `Important updates have been made to ${options.eventName}.`,
    content,
    footerText:
      options.footerText ??
      'You are receiving this email because you registered for an AdugboHub community event.',
  });
}