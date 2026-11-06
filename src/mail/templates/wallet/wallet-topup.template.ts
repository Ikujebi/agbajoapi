
import { baseEmailLayout, escapeHtml } from '../layouts/base-layout.template';

export interface WalletTopupOptions {
  recipientName?: string;
  organizationName: string;
  amount: string;
  currency?: string;
  newBalance: string;
  paymentReference: string;
  paidAt?: Date | string;
  footerText?: string;
}

export function walletTopupTemplate(
  options: WalletTopupOptions,
): string {
  const name = escapeHtml(options.recipientName || 'there');
  const organization = escapeHtml(options.organizationName);
  const amount = escapeHtml(options.amount);
  const currency = escapeHtml(options.currency || 'NGN');
  const balance = escapeHtml(options.newBalance);
  const reference = escapeHtml(options.paymentReference);

  const paidAt = options.paidAt
    ? escapeHtml(
        new Date(options.paidAt).toLocaleString('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      )
    : 'Just now';

  const content = `
    <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 22px;color:#374151;font-size:15px;line-height:1.7;">
      Your wallet top-up for <strong>${organization}</strong>
      was successful. The amount has been added to your organization's wallet.
    </p>

    <div style="padding:22px;background:#f5f3ff;border-radius:14px;margin:0 0 22px;">
      <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">
        Amount credited
      </p>
      <h2 style="margin:0;color:#7137A8;font-size:28px;font-weight:700;">
        ${currency} ${amount}
      </h2>
    </div>

    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Organization</td>
        <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;font-weight:600;">
          ${organization}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">New wallet balance</td>
        <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;font-weight:700;">
          ${currency} ${balance}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Payment reference</td>
        <td style="padding:10px 0;color:#111827;font-size:13px;text-align:right;word-break:break-all;">
          ${reference}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Date</td>
        <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;">
          ${paidAt}
        </td>
      </tr>
    </table>

    <p style="margin:22px 0 0;color:#6b7280;font-size:14px;line-height:1.7;">
      Thank you for using AdugboHub.
    </p>
  `;

  return baseEmailLayout({
    title: 'Wallet top-up successful',
    preheader: `Your ${currency} ${amount} wallet top-up was successful.`,
    content,
    footerText: options.footerText,
  });
}
