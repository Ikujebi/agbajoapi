
// src/mail/templates/events/event-cancellation.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface EventCancellationOptions {
  recipientName?: string;
  eventName: string;
  communityName?: string;
  eventDate?: string;
  eventTime?: string;
  venue?: string;
  cancellationReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  rescheduled?: boolean;
  rescheduledMessage?: string;
  eventUrl?: string;
  supportEmail?: string;
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

export function eventCancellationTemplate(
  options: EventCancellationOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const eventName = escapeHtml(options.eventName);

  const communityName = options.communityName
    ? escapeHtml(options.communityName)
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

  const cancellationReason = options.cancellationReason
    ? escapeHtml(options.cancellationReason)
    : undefined;

  const cancelledBy = options.cancelledBy
    ? escapeHtml(options.cancelledBy)
    : undefined;

  const cancelledAt = options.cancelledAt
    ? escapeHtml(options.cancelledAt)
    : undefined;

  const rescheduledMessage = options.rescheduledMessage
    ? escapeHtml(options.rescheduledMessage)
    : undefined;

  const eventUrl = options.eventUrl
    ? validateHttpsUrl(options.eventUrl)
    : undefined;

  const supportEmail = options.supportEmail
    ? escapeHtml(options.supportEmail)
    : undefined;

  const eventDetails =
    eventDate || eventTime || venue
      ? `
        <table role="presentation" cellspacing="0" cellpadding="0"
          border="0" width="100%"
          style="margin:0 0 24px;background:#f8f6fb;border-radius:10px;">
          <tr>
            <td style="padding:18px;">
              <p style="margin:0 0 6px;color:#777;font-size:12px;">
                EVENT
              </p>
              <p style="margin:0 0 16px;color:#24143f;font-size:15px;font-weight:bold;">
                ${eventName}
              </p>
              ${
                eventDate
                  ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">ORIGINAL DATE</p>
                      <p style="margin:0 0 16px;color:#24143f;font-size:14px;">${eventDate}</p>`
                  : ''
              }
              ${
                eventTime
                  ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">ORIGINAL TIME</p>
                      <p style="margin:0 0 16px;color:#24143f;font-size:14px;">${eventTime}</p>`
                  : ''
              }
              ${
                venue
                  ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">VENUE</p>
                      <p style="margin:0;color:#24143f;font-size:14px;">${venue}</p>`
                  : ''
              }
            </td>
          </tr>
        </table>
      `
      : '';

  const content = `
    <div style="margin:0 0 20px;">
      <span style="display:inline-block;padding:6px 12px;
        background:#fdecec;color:#b42318;border-radius:20px;
        font-size:12px;font-weight:bold;">
        EVENT CANCELLED
      </span>
    </div>

    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      ${eventName} has been cancelled
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      ${
        communityName
          ? `We regret to inform you that the ${communityName} event `
          : 'We regret to inform you that '
      }
      <strong>${eventName}</strong> will no longer take place as scheduled.
    </p>

    ${eventDetails}

    ${
      cancellationReason
        ? `<div style="margin:0 0 24px;padding:18px;
            background:#fff7f7;border-left:4px solid #d62839;
            border-radius:6px;">
            <p style="margin:0 0 8px;color:#9b2727;font-size:12px;font-weight:bold;">
              REASON FOR CANCELLATION
            </p>
            <p style="margin:0;color:#555;font-size:14px;line-height:1.8;">
              ${cancellationReason}
            </p>
          </div>`
        : ''
    }

    ${
      options.rescheduled
        ? `<p style="margin:0 0 16px;color:#555;font-size:14px;line-height:1.8;">
            The event organizer has indicated that this event may be
            rescheduled.
            ${
              rescheduledMessage
                ? ` ${rescheduledMessage}`
                : 'Please watch for a separate update with the new date and details.'
            }
          </p>`
        : `<p style="margin:0 0 16px;color:#555;font-size:14px;line-height:1.8;">
            ${
              rescheduledMessage ??
              'If a new date is announced, you will receive an update.'
            }
          </p>`
    }

    ${
      cancelledBy || cancelledAt
        ? `<p style="margin:0 0 24px;color:#777;font-size:12px;line-height:1.7;">
            ${
              cancelledBy
                ? `Cancelled by ${cancelledBy}.`
                : ''
            }
            ${
              cancelledAt
                ? ` ${cancelledAt}`
                : ''
            }
          </p>`
        : ''
    }

    ${
      eventUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#6b3fa0"
                style="border-radius:8px;">
                <a href="${eventUrl}"
                  style="display:inline-block;padding:13px 24px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  View event updates
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

    ${
      supportEmail
        ? `<p style="margin:20px 0 0;color:#777;font-size:13px;">
            Questions? Contact
            <a href="mailto:${supportEmail}" style="color:#6b3fa0;">
              ${supportEmail}
            </a>.
          </p>`
        : ''
    }

    <p style="margin:24px 0 0;color:#666;font-size:14px;line-height:1.7;">
      We apologise for any inconvenience and appreciate your understanding.
    </p>
  `;

  return baseEmailLayout({
    title: `Event cancelled: ${options.eventName}`,
    preheader: `${options.eventName} has been cancelled. Please read this update.`,
    content,
    footerText:
      options.footerText ??
      'You are receiving this email because you were invited to or registered for this event.',
  });
}
