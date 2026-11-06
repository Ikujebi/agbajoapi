import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrderStatusOptions {
  recipientName?: string;
  shopName: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  message: string;
  updatedAt?: string;
  nextStep?: string;
  orderUrl?: string;
  supportEmail?: string;
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

export function orderStatusTemplate(
  options: OrderStatusOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const shop = escapeHtml(options.shopName);
  const orderNumber = escapeHtml(options.orderNumber);
  const statusLabel = escapeHtml(options.statusLabel);
  const orderUrl = safeUrl(options.orderUrl);

  const content = `
    <p style="margin:0 0 18px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, there's an update on your order from <strong>${shop}</strong>.
    </p>

    <div style="padding:20px;background:#f8f7fb;border-radius:12px;margin-bottom:22px;">
      <p style="margin:0 0 5px;color:#77778a;font-size:12px;">ORDER NUMBER</p>
      <p style="margin:0 0 18px;color:#24243a;font-size:20px;font-weight:700;">${orderNumber}</p>

      <p style="margin:0 0 8px;color:#77778a;font-size:12px;">CURRENT STATUS</p>
      <span style="display:inline-block;padding:8px 13px;background:#fcecef;color:#a91e3b;border-radius:20px;font-size:13px;font-weight:700;">
        ${statusLabel}
      </span>

      <p style="margin:16px 0 0;color:#454559;font-size:14px;line-height:1.7;">
        ${escapeHtml(options.message)}
      </p>
      ${
        options.updatedAt
          ? `<p style="margin:12px 0 0;color:#88889a;font-size:12px;">Updated: ${escapeHtml(options.updatedAt)}</p>`
          : ''
      }
    </div>

    ${
      options.nextStep
        ? `<div style="padding:16px;border-left:3px solid #c62845;background:#fff8f9;border-radius:6px;margin-bottom:20px;">
            <p style="margin:0 0 5px;color:#24243a;font-size:13px;font-weight:700;">What happens next?</p>
            <p style="margin:0;color:#55556a;font-size:13px;line-height:1.6;">${escapeHtml(options.nextStep)}</p>
          </div>`
        : ''
    }

    ${
      orderUrl
        ? `<p style="margin:24px 0 0;">
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              View order
            </a>
          </p>`
        : ''
    }

    ${
      options.supportEmail
        ? `<p style="margin:20px 0 0;color:#77778a;font-size:13px;">
            Need help? Contact <a href="mailto:${escapeHtml(options.supportEmail)}" style="color:#a91e3b;">${escapeHtml(options.supportEmail)}</a>.
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: `Order ${options.orderNumber}: ${options.statusLabel}`,
    preheader: `Your order status has been updated to ${options.statusLabel}.`,
    content,
    footerText: options.footerText,
  });
}