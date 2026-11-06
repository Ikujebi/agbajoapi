import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrderConfirmationItem {
  name: string;
  quantity: number;
}

export interface OrderConfirmationOptions {
  recipientName?: string;
  shopName: string;
  orderNumber: string;
  items: OrderConfirmationItem[];
  total: string;
  fulfillmentType?: 'PICKUP' | 'DELIVERY';
  estimatedFulfillment?: string;
  orderUrl?: string;
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

export function orderConfirmationTemplate(
  options: OrderConfirmationOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const shop = escapeHtml(options.shopName);
  const orderNumber = escapeHtml(options.orderNumber);
  const orderUrl = safeUrl(options.orderUrl);

  const items = options.items
    .map(
      (item) => `
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#454559;font-size:14px;">
            ${escapeHtml(item.name)}
          </td>
          <td align="right" style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#454559;font-size:14px;">
            × ${item.quantity}
          </td>
        </tr>
      `,
    )
    .join('');

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;padding:12px 18px;background:#edf8f1;border-radius:30px;color:#16804a;font-size:13px;font-weight:700;">
        Order placed successfully
      </div>
    </div>

    <p style="margin:0 0 16px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, thank you for shopping with <strong>${shop}</strong>.
      We've received your order and the shop will begin processing it.
    </p>

    <div style="padding:18px;background:#f8f7fb;border-radius:12px;margin-bottom:22px;">
      <p style="margin:0 0 5px;color:#77778a;font-size:12px;">ORDER NUMBER</p>
      <p style="margin:0;color:#24243a;font-size:21px;font-weight:700;">${orderNumber}</p>
      <p style="margin:12px 0 0;color:#77778a;font-size:13px;">Order total</p>
      <p style="margin:3px 0 0;color:#24243a;font-size:20px;font-weight:700;">${escapeHtml(options.total)}</p>
    </div>

    <h3 style="margin:0 0 10px;color:#24243a;font-size:16px;">Your order</h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      ${items}
    </table>

    ${
      options.fulfillmentType || options.estimatedFulfillment
        ? `<div style="margin-top:20px;padding:16px;border:1px solid #eeeef2;border-radius:12px;">
            ${
              options.fulfillmentType
                ? `<p style="margin:0;color:#55556a;font-size:14px;"><strong>Fulfilment:</strong> ${options.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'}</p>`
                : ''
            }
            ${
              options.estimatedFulfillment
                ? `<p style="margin:8px 0 0;color:#55556a;font-size:14px;"><strong>Estimated fulfilment:</strong> ${escapeHtml(options.estimatedFulfillment)}</p>`
                : ''
            }
          </div>`
        : ''
    }

    ${
      orderUrl
        ? `<p style="margin:26px 0 0;">
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              Track your order
            </a>
          </p>`
        : ''
    }

    <p style="margin:22px 0 0;color:#77778a;font-size:13px;line-height:1.6;">
      We'll keep you updated as your order progresses.
    </p>
  `;

  return baseEmailLayout({
    title: `Order ${options.orderNumber} confirmed`,
    preheader: `Your order at ${options.shopName} has been received.`,
    content,
    footerText: options.footerText,
  });
}