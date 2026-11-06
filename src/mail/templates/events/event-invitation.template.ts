
// src/mail/templates/events/event-invitation.template.ts

import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface EventInvitationOptions {
  recipientName?: string;
  eventName: string;
  communityName?: string;
  organizerName?: string;
  eventDescription?: string;
  eventDate: string;
  eventTime?: string;
  venue?: string;
  eventUrl: string;
  expiresIn?: string;
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

export function eventInvitationTemplate(
  options: EventInvitationOptions,
): string {
  const recipientName = options.recipientName
    ? escapeHtml(options.recipientName)
    : 'there';

  const eventName = escapeHtml(options.eventName);
  const eventUrl = validateHttpsUrl(options.eventUrl);

  const communityName = options.communityName
    ? escapeHtml(options.communityName)
    : undefined;

  const organizerName = options.organizerName
    ? escapeHtml(options.organizerName)
    : 'The event organizer';

  const description = options.eventDescription
    ? escapeHtml(options.eventDescription)
    : undefined;

  const eventDate = escapeHtml(options.eventDate);
  const eventTime = options.eventTime
    ? escapeHtml(options.eventTime)
    : undefined;

  const venue = options.venue
    ? escapeHtml(options.venue)
    : undefined;

  const expiresIn = options.expiresIn
    ? escapeHtml(options.expiresIn)
    : undefined;

  const content = `
    <div style="margin:0 0 20px;">
      <span style="display:inline-block;padding:6px 12px;
        background:#f3eafa;color:#6b3fa0;border-radius:20px;
        font-size:12px;font-weight:bold;">
        EVENT INVITATION
      </span>
    </div>

    <h2 style="margin:0 0 16px;color:#24143f;font-size:24px;line-height:1.4;">
      You're invited to ${eventName}
    </h2>

    <p style="margin:0 0 16px;color:#555;font-size:15px;line-height:1.7;">
      Hello ${recipientName},
    </p>

    <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.8;">
      ${organizerName} has invited you to attend
      <strong>${eventName}</strong>.
      ${
        communityName
          ? `This event is organised for ${communityName}.`
          : ''
      }
    </p>

    ${
      description
        ? `<p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.8;">
            ${description}
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

    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 24px;">
      <tr>
        <td align="center" bgcolor="#d62839" style="border-radius:8px;">
          <a href="${eventUrl}"
            style="display:inline-block;padding:14px 26px;color:#ffffff;
            font-size:14px;font-weight:bold;text-decoration:none;
            border-radius:8px;">
            View event invitation
          </a>
        </td>
      </tr>
    </table>

    ${
      expiresIn
        ? `<p style="margin:0 0 12px;color:#777;font-size:13px;">
            This invitation expires in ${expiresIn}.
          </p>`
        : ''
    }

    <p style="margin:0;color:#666;font-size:14px;line-height:1.7;">
      We hope to see you there!
    </p>
  `;

  return baseEmailLayout({
    title: `You're invited: ${options.eventName}`,
    preheader: `You're invited to ${options.eventName}.`,
    content,
    footerText:
      options.footerText ??
      'You received this email because someone invited you to an AdugboHub community event.',
  });
}
