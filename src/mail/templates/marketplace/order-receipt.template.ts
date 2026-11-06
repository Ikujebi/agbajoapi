import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface OrderReceiptItem {
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface OrderReceiptOptions {
  recipientName?: string;
  shopName: string;
  orderNumber: string;
  receiptReference?: string;
  issuedAt?: string;
  items: OrderReceiptItem[];
  subtotal: string;
  deliveryFee?: string;
  discount?: string;
  tax?: string;
  total: string;
  paymentMethod?: string;
  paymentStatus?: string;
  fulfillmentType?: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
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

export function orderReceiptTemplate(
  options: OrderReceiptOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const shop = escapeHtml(options.shopName);
  const orderNumber = escapeHtml(options.orderNumber);
  const orderUrl = safeUrl(options.orderUrl);

  const itemRows = options.items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 6px 12px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:13px;">
            ${escapeHtml(item.name)}
            <div style="margin-top:4px;color:#88889a;font-size:12px;">
              ${escapeHtml(item.unitPrice)} × ${item.quantity}
            </div>
          </td>
          <td align="right" style="padding:12px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:13px;white-space:nowrap;">
            ${escapeHtml(item.lineTotal)}
          </td>
        </tr>
      `,
    )
    .join('');

  const totalRows = [
    ['Subtotal', options.subtotal, ''],
    ['Delivery fee', options.deliveryFee, ''],
    ['Discount', options.discount, 'discount'],
    ['Tax', options.tax, ''],
  ]
    .filter((row) => Boolean(row[1]))
    .map(
      ([label, value, kind]) => `
        <tr>
          <td style="padding:7px 0;color:${kind === 'discount' ? '#16804a' : '#77778a'};font-size:13px;">
            ${label}
          </td>
          <td align="right" style="padding:7px 0;color:${kind === 'discount' ? '#16804a' : '#454559'};font-size:13px;">
            ${kind === 'discount' ? '-' : ''}${escapeHtml(value as string)}
          </td>
        </tr>
      `,
    )
    .join('');

  const content = `
    <p style="margin:0 0 18px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, here's your order summary from <strong>${shop}</strong>.
    </p>

    <div style="padding:18px;background:#f8f7fb;border-radius:12px;margin-bottom:22px;">
      <p style="margin:0 0 5px;color:#77778a;font-size:12px;">ORDER RECEIPT</p>
      <p style="margin:0;color:#24243a;font-size:20px;font-weight:700;">${orderNumber}</p>
      ${
        options.receiptReference
          ? `<p style="margin:9px 0 0;color:#77778a;font-size:12px;">Receipt reference: ${escapeHtml(options.receiptReference)}</p>`
          : ''
      }
      ${
        options.issuedAt
          ? `<p style="margin:5px 0 0;color:#77778a;font-size:12px;">Issued: ${escapeHtml(options.issuedAt)}</p>`
          : ''
      }
    </div>

    <h3 style="margin:0 0 10px;color:#24243a;font-size:16px;">Items</h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      ${itemRows}
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border-collapse:collapse;">
      ${totalRows}
      <tr>
        <td style="padding:13px 0;border-top:1px solid #dedee6;color:#24243a;font-size:15px;font-weight:700;">Total</td>
        <td align="right" style="padding:13px 0;border-top:1px solid #dedee6;color:#24243a;font-size:16px;font-weight:700;">${escapeHtml(options.total)}</td>
      </tr>
    </table>

    <div style="margin-top:20px;padding:16px;border:1px solid #eeeef2;border-radius:12px;">
      ${
        options.paymentStatus
          ? `<p style="margin:0 0 8px;color:#55556a;font-size:13px;"><strong>Payment status:</strong> ${escapeHtml(options.paymentStatus)}</p>`
          : ''
      }
      ${
        options.paymentMethod
          ? `<p style="margin:0 0 8px;color:#55556a;font-size:13px;"><strong>Payment method:</strong> ${escapeHtml(options.paymentMethod)}</p>`
          : ''
      }
      ${
        options.fulfillmentType
          ? `<p style="margin:0 0 8px;color:#55556a;font-size:13px;"><strong>Fulfilment:</strong> ${options.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'}</p>`
          : ''
      }
      ${
        options.deliveryAddress
          ? `<p style="margin:0;color:#55556a;font-size:13px;"><strong>Delivery address:</strong> ${escapeHtml(options.deliveryAddress)}</p>`
          : ''
      }
    </div>

    ${
      orderUrl
        ? `<p style="margin:24px 0 0;">
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              View order details
            </a>
          </p>`
        : ''
    }
  `;

  return baseEmailLayout({
    title: `Receipt for order ${options.orderNumber}`,
    preheader: `Your order summary from ${options.shopName}.`,
    content,
    footerText: options.footerText,
  });
}