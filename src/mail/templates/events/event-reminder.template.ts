
// src/mail/templates/events/event-reminder.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface EventReminderOptions {
  recipientName?: string;
  eventName: string;
  communityName?: string;
  reminderMessage?: string;
  eventDate: string;
  eventTime?: string;
  venue?: string;
  startsIn?: string;
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

export function eventReminderTemplate(
  options: EventReminderOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const eventName = escapeHtml(options.eventName);

  const communityName = options.communityName
    ? escapeHtml(options.communityName)
    : undefined;

  const reminderMessage = options.reminderMessage
    ? escapeHtml(options.reminderMessage)
    : undefined;

  const eventDate = escapeHtml(options.eventDate);

  const eventTime = options.eventTime
    ? escapeHtml(options.eventTime)
    : undefined;

  const venue = options.venue
    ? escapeHtml(options.venue)
    : undefined;

  const startsIn = options.startsIn
    ? escapeHtml(options.startsIn)
    : undefined;

  const eventUrl = options.eventUrl
    ? validateHttpsUrl(options.eventUrl)
    : undefined;

  const content = `
    <div style="margin:0 0 20px;">
      <span style="display:inline-block;padding:6px 12px;
        background:#fff4e5;color:#9a6700;border-radius:20px;
        font-size:12px;font-weight:bold;">
        EVENT REMINDER
      </span>
    </div>

    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      ${startsIn ? `Coming up in ${startsIn}` : 'Your event is coming up!'}
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      This is a friendly reminder about
      <strong>${eventName}</strong>.
      ${
        communityName
          ? `The event is organised by ${communityName}.`
          : ''
      }
    </p>

    ${
      reminderMessage
        ? `<p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.8;">
            ${reminderMessage}
          </p>`
        : ''
    }

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      width="100%" style="margin:0 0 24px;background:#f8f6fb;
      border-radius:10px;">
      <tr>
        <td style="padding:18px;">
          <p style="margin:0 0 6px;color:#777;font-size:12px;">EVENT</p>
          <p style="margin:0 0 16px;color:#24143f;font-size:15px;font-weight:bold;">
            ${eventName}
          </p>

          <p style="margin:0 0 6px;color:#777;font-size:12px;">DATE</p>
          <p style="margin:0 0 16px;color:#24143f;font-size:14px;">
            ${eventDate}
          </p>

          ${
            eventTime
              ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">TIME</p>
                  <p style="margin:0 0 16px;color:#24143f;font-size:14px;">
                    ${eventTime}
                  </p>`
              : ''
          }

          ${
            venue
              ? `<p style="margin:0 0 6px;color:#777;font-size:12px;">VENUE</p>
                  <p style="margin:0;color:#24143f;font-size:14px;">
                    ${venue}
                  </p>`
              : ''
          }
        </td>
      </tr>
    </table>

    ${
      eventUrl
        ? `<table role="presentation" cellspacing="0" cellpadding="0"
            border="0" style="margin:24px 0;">
            <tr>
              <td align="center" bgcolor="#d62839"
                style="border-radius:8px;">
                <a href="${eventUrl}"
                  style="display:inline-block;padding:14px 26px;
                  color:#ffffff;font-size:14px;font-weight:bold;
                  text-decoration:none;border-radius:8px;">
                  View event details
                </a>
              </td>
            </tr>
          </table>`
        : ''
    }

    <p style="margin:0;color:#666;font-size:14px;line-height:1.7;">
      We look forward to seeing you there. Please check the event details
      before setting out.
    </p>
  `;

  return baseEmailLayout({
    title: `Reminder: ${options.eventName}`,
    preheader: `Don't forget: ${options.eventName} is coming up.`,
    content,
    footerText:
      options.footerText ??
      'You are receiving this reminder because you registered for an AdugboHub community event.',
  });
}
