import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface NewOrderItem {
  name: string;
  quantity: number;
  unitPrice?: string;
  total?: string;
}

export interface NewOrderNotificationOptions {
  recipientName?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  shopName: string;
  orderNumber: string;
  items: NewOrderItem[];
  subtotal?: string;
  deliveryFee?: string;
  discount?: string;
  total: string;
  fulfillmentType?: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  customerNote?: string;
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

export function newOrderNotificationTemplate(
  options: NewOrderNotificationOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'Shop team');
  const customer = escapeHtml(options.customerName);
  const shop = escapeHtml(options.shopName);
  const orderNumber = escapeHtml(options.orderNumber);

  const itemRows = options.items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:14px;">
            ${escapeHtml(item.name)}
            <span style="color:#77778a;"> × ${item.quantity}</span>
          </td>
          <td align="right" style="padding:12px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:14px;">
            ${escapeHtml(item.total || item.unitPrice || '—')}
          </td>
        </tr>
      `,
    )
    .join('');

  const orderUrl = safeUrl(options.orderUrl);

  const summaryRows = [
    options.subtotal
      ? `<tr><td style="padding:7px 0;color:#77778a;">Subtotal</td><td align="right">${escapeHtml(options.subtotal)}</td></tr>`
      : '',
    options.deliveryFee
      ? `<tr><td style="padding:7px 0;color:#77778a;">Delivery fee</td><td align="right">${escapeHtml(options.deliveryFee)}</td></tr>`
      : '',
    options.discount
      ? `<tr><td style="padding:7px 0;color:#16804a;">Discount</td><td align="right" style="color:#16804a;">-${escapeHtml(options.discount)}</td></tr>`
      : '',
  ].join('');

  const content = `
    <p style="margin:0 0 18px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, a new order has been placed at <strong>${shop}</strong>.
    </p>

    <div style="padding:18px;border-radius:12px;background:#f8f7fb;margin-bottom:22px;">
      <p style="margin:0 0 6px;color:#77778a;font-size:12px;text-transform:uppercase;letter-spacing:1px;">
        New order
      </p>
      <p style="margin:0;color:#24243a;font-size:22px;font-weight:700;">
        ${orderNumber}
      </p>
      <p style="margin:8px 0 0;color:#77778a;font-size:13px;">
        Customer: ${customer}
      </p>
    </div>

    <h3 style="margin:0 0 10px;color:#24243a;font-size:16px;">Order items</h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      ${itemRows}
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;color:#303044;font-size:14px;">
      ${summaryRows}
      <tr>
        <td style="padding:12px 0;font-weight:700;border-top:1px solid #dedee6;">Order total</td>
        <td align="right" style="padding:12px 0;font-weight:700;border-top:1px solid #dedee6;">${escapeHtml(options.total)}</td>
      </tr>
    </table>

    <div style="margin-top:22px;padding:16px;border:1px solid #eeeef2;border-radius:12px;">
      <p style="margin:0 0 8px;color:#24243a;font-weight:700;">Fulfilment</p>
      <p style="margin:0;color:#55556a;font-size:14px;">
        ${options.fulfillmentType === 'PICKUP' ? 'Customer pickup' : options.fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Not specified'}
      </p>
      ${
        options.deliveryAddress
          ? `<p style="margin:8px 0 0;color:#55556a;font-size:14px;">${escapeHtml(options.deliveryAddress)}</p>`
          : ''
      }
      ${
        options.customerNote
          ? `<p style="margin:12px 0 0;color:#55556a;font-size:14px;"><strong>Customer note:</strong> ${escapeHtml(options.customerNote)}</p>`
          : ''
      }
    </div>

    ${
      options.customerEmail || options.customerPhone
        ? `<p style="margin:18px 0 0;color:#77778a;font-size:13px;">
            ${options.customerEmail ? `Email: ${escapeHtml(options.customerEmail)}` : ''}
            ${options.customerEmail && options.customerPhone ? '<br>' : ''}
            ${options.customerPhone ? `Phone: ${escapeHtml(options.customerPhone)}` : ''}
          </p>`
        : ''
    }

    ${
      orderUrl
        ? `<p style="margin:26px 0 0;">
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              View order
            </a>
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: `New order ${options.orderNumber}`,
    preheader: `A new order has been placed at ${options.shopName}.`,
    content,
    footerText: options.footerText,
  });
}