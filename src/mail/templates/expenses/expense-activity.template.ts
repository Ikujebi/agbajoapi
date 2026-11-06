
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export type ExpenseActivityType =
  | 'CREATED'
  | 'UPDATED'
  | 'DELETED'
  | 'RECEIPT_ATTACHED';

export interface ExpenseActivityOptions {
  recipientName?: string;
  organizationName: string;
  expenseId: string;
  activity: ExpenseActivityType;
  description: string;
  category: string;
  amount: string;
  reference?: string | null;
  incurredAt?: Date | string;
  actorName?: string;
  changes?: string[];
  footerText?: string;
}

const activityLabels: Record<ExpenseActivityType, string> = {
  CREATED: 'New expense recorded',
  UPDATED: 'Expense updated',
  DELETED: 'Expense deleted',
  RECEIPT_ATTACHED: 'Receipt attached to expense',
};

export function expenseActivityTemplate(
  options: ExpenseActivityOptions,
): string {
  const recipient = options.recipientName
    ? `Hello ${escapeHtml(options.recipientName)},`
    : 'Hello,';

  const date = options.incurredAt
    ? new Date(options.incurredAt).toLocaleString('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Not specified';

  const changes =
    options.changes?.length
      ? `
        <tr>
          <td style="padding:12px 0;color:#64748b;font-size:13px;vertical-align:top;">
            Changes
          </td>
          <td style="padding:12px 0;color:#334155;font-size:14px;">
            ${options.changes.map((change) => `<div style="margin-bottom:6px;">${escapeHtml(change)}</div>`).join('')}
          </td>
        </tr>`
      : '';

  const content = `
    <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
      ${recipient}
    </p>

    <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.7;">
      An expense record in
      <strong>${escapeHtml(options.organizationName)}</strong>
      has been affected by the following activity:
    </p>

    <div style="padding:16px 18px;background:#fff7f7;border:1px solid #fee2e2;border-radius:12px;margin-bottom:20px;">
      <p style="margin:0;color:#991b1b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">
        ${escapeHtml(activityLabels[options.activity])}
      </p>
      <p style="margin:8px 0 0;color:#0f172a;font-size:20px;font-weight:700;">
        ₦${escapeHtml(options.amount)}
      </p>
    </div>

    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;width:38%;border-bottom:1px solid #e2e8f0;">
          Description
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(options.description)}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">
          Category
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(options.category.replace(/_/g, ' '))}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">
          Expense date
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(date)}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">
          Reference
        </td>
        <td style="padding:12px 0;color:#334155;font-size:14px;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(options.reference || 'None')}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;">
          Expense ID
        </td>
        <td style="padding:12px 0;color:#334155;font-size:12px;word-break:break-all;">
          ${escapeHtml(options.expenseId)}
        </td>
      </tr>
      ${changes}
    </table>

    ${
      options.actorName
        ? `<p style="margin:20px 0 0;color:#64748b;font-size:13px;">Recorded by: <strong>${escapeHtml(options.actorName)}</strong></p>`
        : ''
    }

    <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
      This is an automatic notification from AdugboHub.
    </p>
  `;

  return baseEmailLayout({
    title: activityLabels[options.activity],
    preheader: `${activityLabels[options.activity]} — ${options.organizationName}`,
    content,
    footerText: options.footerText,
  });
}
