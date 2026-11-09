
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface LowStockProduct {
  name: string;
  quantity: number;
  lowStockAt: number;
}

export interface InventoryLowStockOptions {
  recipientName?: string;
  organizationName: string;
  products: LowStockProduct[];
  footerText?: string;
}

export function inventoryLowStockTemplate(
  options: InventoryLowStockOptions,
): string {
  const greeting = options.recipientName
    ? `Hello ${escapeHtml(options.recipientName)},`
    : 'Hello,';

  const rows = options.products
    .map(
      (product) => `
        <tr>
          <td style="padding:13px 10px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:14px;">
            ${escapeHtml(product.name)}
          </td>
          <td style="padding:13px 10px;border-bottom:1px solid #e2e8f0;color:#b91c1c;font-size:14px;font-weight:700;text-align:center;">
            ${product.quantity}
          </td>
          <td style="padding:13px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:14px;text-align:center;">
            ${product.lowStockAt}
          </td>
        </tr>
      `,
    )
    .join('');

  const content = `
    <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
      ${greeting}
    </p>

    <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.7;">
      Some products in <strong>${escapeHtml(options.organizationName)}</strong>
      have reached or fallen below their low-stock levels.
      Please review the inventory and arrange restocking where necessary.
    </p>

    <div style="padding:16px 18px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;margin-bottom:20px;">
      <p style="margin:0;color:#9a3412;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">
        Inventory alert
      </p>
      <p style="margin:8px 0 0;color:#0f172a;font-size:24px;font-weight:700;">
        ${options.products.length}
      </p>
      <p style="margin:4px 0 0;color:#64748b;font-size:13px;">
        product${options.products.length === 1 ? '' : 's'} need attention
      </p>
    </div>

    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:12px 10px;text-align:left;color:#64748b;font-size:12px;">
            Product
          </th>
          <th style="padding:12px 10px;text-align:center;color:#64748b;font-size:12px;">
            Current stock
          </th>
          <th style="padding:12px 10px;text-align:center;color:#64748b;font-size:12px;">
            Stock threshold
          </th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
      This is your scheduled AdugboHub inventory notification.
    </p>
  `;

  return baseEmailLayout({
    title: 'Low stock inventory alert',
    preheader: `${options.products.length} product(s) need attention at ${options.organizationName}`,
    content,
    footerText: options.footerText,
  });
}
