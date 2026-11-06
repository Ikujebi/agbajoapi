
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface ListingInquiryEmailOptions {
  recipientName?: string;
  listingTitle: string;
  buyerName?: string;
  message: string;
}

export function listingInquiryTemplate(
  options: ListingInquiryEmailOptions,
): string {
  const recipientName = options.recipientName?.trim();
  const buyerName = options.buyerName?.trim();

  const greeting = recipientName
    ? `Hello ${escapeHtml(recipientName)},`
    : 'Hello,';

  const sender = buyerName
    ? escapeHtml(buyerName)
    : 'Someone in your community';

  const listingTitle = escapeHtml(options.listingTitle);
  const message = escapeHtml(options.message).replace(/\r?\n/g, '<br>');

  return baseEmailLayout({
    title: 'New marketplace inquiry',
    preheader: `Someone is interested in your listing: ${options.listingTitle}`,
    content: `
      <h2 style="margin:0 0 18px;color:#252238;font-size:23px;">
        You have a new inquiry!
      </h2>

      <p style="margin:0 0 18px;">
        ${greeting}
      </p>

      <p style="margin:0 0 18px;">
        ${sender} has sent you a message about your marketplace listing:
      </p>

      <div style="
        margin:22px 0;
        padding:18px;
        background:#F8F5FC;
        border-left:4px solid #7137A8;
        border-radius:8px;
      ">
        <p style="margin:0 0 8px;color:#777487;font-size:12px;font-weight:bold;text-transform:uppercase;">
          Listing
        </p>

        <p style="margin:0;color:#252238;font-size:17px;font-weight:bold;">
          ${listingTitle}
        </p>
      </div>

      <p style="margin:0 0 8px;font-weight:bold;">
        Their message:
      </p>

      <div style="
        margin:0 0 24px;
        padding:18px;
        background:#F5F6FA;
        border:1px solid #E9E7EF;
        border-radius:8px;
        color:#252238;
        white-space:normal;
        overflow-wrap:anywhere;
      ">
        ${message}
      </div>

      <p style="margin:0;">
        Sign in to AdugboHub to view and respond to this inquiry.
      </p>
    `,
  });
}
