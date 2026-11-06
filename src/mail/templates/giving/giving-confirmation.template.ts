
import { baseEmailLayout, escapeHtml } from '../layouts/base-layout.template';

export interface GivingConfirmationOptions {
  recipientName?: string;
  organizationName: string;
  givingType: string;
  amount: string;
  currency?: string;
  paymentReference: string;
  paidAt?: Date | string;
  isPledgePayment?: boolean;
  footerText?: string;
}

export function givingConfirmationTemplate(
  options: GivingConfirmationOptions,
): string {
  const name = escapeHtml(options.recipientName || 'there');
  const organization = escapeHtml(options.organizationName);
  const givingType = escapeHtml(
    options.givingType.replace(/_/g, ' ').toLowerCase(),
  );
  const amount = escapeHtml(options.amount);
  const currency = escapeHtml(options.currency || 'NGN');
  const reference = escapeHtml(options.paymentReference);

  const paidAt = options.paidAt
    ? escapeHtml(
        new Date(options.paidAt).toLocaleString('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      )
    : 'Just now';

  const description = options.isPledgePayment
    ? 'Your pledge payment has been received and recorded.'
    : 'Your contribution has been received and recorded.';

  const content = `
    <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">
      Hello ${name},
    </p>

    <p style="margin:0 0 22px;color:#374151;font-size:15px;line-height:1.7;">
      ${description} Thank you for supporting
      <strong>${organization}</strong>.
    </p>

    <div style="padding:22px;background:#fdf2f8;border-radius:14px;margin:0 0 22px;">
      <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">
        Amount received
      </p>
      <h2 style="margin:0;color:#D92D45;font-size:28px;font-weight:700;">
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
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Giving category</td>
        <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;">
          ${givingType}
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
      Thank you for your generosity. May your kindness make a lasting difference.
    </p>
  `;

  return baseEmailLayout({
    title: 'Giving payment confirmed',
    preheader: `Your ${currency} ${amount} contribution has been recorded.`,
    content,
    footerText: options.footerText,
  });
}
