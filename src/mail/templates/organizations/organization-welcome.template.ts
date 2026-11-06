import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrganizationWelcomeOptions {
  recipientName?: string;
  organizationName: string;
  organizationDescription?: string;
  memberName?: string;
  roleLabel?: string;
  joinedAt?: string;
  welcomeMessage?: string;
  dashboardUrl?: string;
  communityUrl?: string;
  footerText?: string;
}

function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function organizationWelcomeTemplate(
  options: OrganizationWelcomeOptions,
): string {
  const recipient = escapeHtml(
    options.recipientName || options.memberName || 'there',
  );
  const organization = escapeHtml(options.organizationName);
  const dashboardUrl = safeUrl(options.dashboardUrl);
  const communityUrl = safeUrl(options.communityUrl);

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;padding:11px 17px;background:#edf8f1;color:#16804a;border-radius:30px;font-size:12px;font-weight:700;">
        Membership confirmed
      </div>
      <h2 style="margin:16px 0 0;color:#24243a;font-size:24px;line-height:1.35;">
        Welcome to ${organization}!
      </h2>
    </div>

    <p style="margin:0 0 16px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, we're glad to welcome you to <strong>${organization}</strong>.
      Your membership has been confirmed.
    </p>

    ${
      options.organizationDescription
        ? `<p style="margin:0 0 18px;color:#55556a;font-size:14px;line-height:1.8;">
            ${escapeHtml(options.organizationDescription)}
          </p>`
        : ''
    }

    ${
      options.welcomeMessage
        ? `<div style="padding:18px;background:#f8f7fb;border-radius:12px;margin-bottom:20px;">
            <p style="margin:0;color:#454559;font-size:14px;line-height:1.8;">
              ${escapeHtml(options.welcomeMessage)}
            </p>
          </div>`
        : ''
    }

    ${
      options.roleLabel || options.joinedAt
        ? `<div style="padding:16px;border:1px solid #eeeef2;border-radius:12px;margin-bottom:20px;">
            ${
              options.roleLabel
                ? `<p style="margin:0 0 8px;color:#55556a;font-size:13px;"><strong>Membership role:</strong> ${escapeHtml(options.roleLabel)}</p>`
                : ''
            }
            ${
              options.joinedAt
                ? `<p style="margin:0;color:#55556a;font-size:13px;"><strong>Joined:</strong> ${escapeHtml(options.joinedAt)}</p>`
                : ''
            }
          </div>`
        : ''
    }

    ${
      dashboardUrl
        ? `<p style="margin:24px 0 12px;text-align:center;">
            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:14px 24px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              Open your dashboard
            </a>
          </p>`
        : ''
    }

    ${
      communityUrl
        ? `<p style="margin:12px 0 0;text-align:center;">
            <a href="${escapeHtml(communityUrl)}" style="color:#a91e3b;text-decoration:none;font-size:13px;font-weight:600;">
              Explore your community
            </a>
          </p>`
        : ''
    }

    <p style="margin:24px 0 0;color:#77778a;font-size:13px;line-height:1.7;">
      We look forward to having you participate and connect with other members.
    </p>
  `;

  return baseEmailLayout({
    title: `Welcome to ${options.organizationName}`,
    preheader: `Your membership at ${options.organizationName} is confirmed.`,
    content,
    footerText: options.footerText,
  });
}