import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface PaymentConfirmationOptions {
  recipientName?: string;
  shopName: string;
  orderNumber: string;
  paymentReference: string;
  amountPaid: string;
  currency?: string;
  paymentMethod?: string;
  paidAt?: string;
  transactionReference?: string;
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

export function paymentConfirmationTemplate(
  options: PaymentConfirmationOptions,
): string {
  const recipient = escapeHtml(options.recipientName || 'there');
  const shop = escapeHtml(options.shopName);
  const orderNumber = escapeHtml(options.orderNumber);
  const orderUrl = safeUrl(options.orderUrl);

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:50%;background:#edf8f1;color:#16804a;font-size:25px;font-weight:700;">
        &#10003;
      </div>
      <h2 style="margin:14px 0 0;color:#24243a;font-size:22px;">Payment received</h2>
      <p style="margin:7px 0 0;color:#77778a;font-size:13px;">Your payment has been confirmed.</p>
    </div>

    <p style="margin:0 0 18px;color:#454559;font-size:15px;line-height:1.7;">
      Hello ${recipient}, we've successfully confirmed your payment for your order from <strong>${shop}</strong>.
    </p>

    <div style="padding:22px;background:#f8f7fb;border-radius:12px;text-align:center;margin-bottom:22px;">
      <p style="margin:0;color:#77778a;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Amount paid</p>
      <p style="margin:8px 0 0;color:#24243a;font-size:28px;font-weight:700;">
        ${escapeHtml(options.amountPaid)}
      </p>
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#77778a;font-size:13px;">Order number</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:13px;font-weight:600;">${orderNumber}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#77778a;font-size:13px;">Payment reference</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:13px;font-weight:600;">${escapeHtml(options.paymentReference)}</td>
      </tr>
      ${
        options.transactionReference
          ? `<tr>
              <td style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#77778a;font-size:13px;">Transaction reference</td>
              <td align="right" style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:13px;">${escapeHtml(options.transactionReference)}</td>
            </tr>`
          : ''
      }
      ${
        options.paymentMethod
          ? `<tr>
              <td style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#77778a;font-size:13px;">Payment method</td>
              <td align="right" style="padding:11px 0;border-bottom:1px solid #eeeef2;color:#303044;font-size:13px;">${escapeHtml(options.paymentMethod)}</td>
            </tr>`
          : ''
      }
      ${
        options.paidAt
          ? `<tr>
              <td style="padding:11px 0;color:#77778a;font-size:13px;">Paid on</td>
              <td align="right" style="padding:11px 0;color:#303044;font-size:13px;">${escapeHtml(options.paidAt)}</td>
            </tr>`
          : ''
      }
    </table>

    ${
      orderUrl
        ? `<p style="margin:26px 0 0;">
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;padding:13px 22px;background:#c62845;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
              View order
            </a>
          </p>`
        : ''
    }

    <p style="margin:20px 0 0;color:#77778a;font-size:13px;line-height:1.6;">
      Keep this email as confirmation of your payment.
    </p>
  `;

  return baseEmailLayout({
    title: `Payment confirmed for order ${options.orderNumber}`,
    preheader: `We've received your payment of ${options.amountPaid}.`,
    content,
    footerText: options.footerText,
  });
}