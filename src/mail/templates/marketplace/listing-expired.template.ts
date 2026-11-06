
import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface ListingExpiredEmailOptions {
  recipientName?: string;
  expiredCount: number;
  listingTitles?: string[];
}

export function listingExpiredTemplate(
  options: ListingExpiredEmailOptions,
): string {
  const recipientName = options.recipientName?.trim();

  const greeting = recipientName
    ? `Hello ${escapeHtml(recipientName)},`
    : 'Hello,';

  const count = Math.max(0, Math.floor(options.expiredCount));
  const noun = count === 1 ? 'listing has' : 'listings have';

  const titles = (options.listingTitles ?? [])
    .slice(0, 10)
    .map(
      (title) => `
        <li style="margin:0 0 8px;">
          ${escapeHtml(title)}
        </li>
      `,
    )
    .join('');

  const listingSection = titles
    ? `
      <div style="
        margin:22px 0;
        padding:18px;
        background:#F5F6FA;
        border:1px solid #E9E7EF;
        border-radius:8px;
      ">
        <p style="margin:0 0 12px;font-weight:bold;">
          Expired listings
        </p>

        <ul style="margin:0;padding-left:20px;">
          ${titles}
        </ul>
      </div>
    `
    : '';

  return baseEmailLayout({
    title: 'Your marketplace listing has expired',
    preheader: `${count} of your marketplace ${count === 1 ? 'listing has' : 'listings have'} expired.`,
    content: `
      <h2 style="margin:0 0 18px;color:#252238;font-size:23px;">
        Your listing${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} expired
      </h2>

      <p style="margin:0 0 18px;">
        ${greeting}
      </p>

      <p style="margin:0 0 18px;">
        ${count} of your marketplace ${noun} reached its expiration date
        and is no longer available to buyers.
      </p>

      ${listingSection}

      <div style="
        margin:22px 0;
        padding:18px;
        background:#FFF5F5;
        border-left:4px solid #D92D45;
        border-radius:8px;
      ">
        <p style="margin:0;font-weight:bold;color:#252238;">
          Want to keep selling?
        </p>

        <p style="margin:8px 0 0;color:#777487;">
          Visit your AdugboHub marketplace dashboard to renew your
          expired listings and make them available to buyers again.
        </p>
      </div>

      <p style="margin:0;">
        Thank you for using AdugboHub.
      </p>
    `,
  });
}
