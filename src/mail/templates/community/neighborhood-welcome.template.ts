import {
  baseEmailLayout,
  escapeHtml,
} from '../layouts/base-layout.template';

export interface NeighborhoodWelcomeEmailOptions {
  recipientName?: string;
  neighborhoodName: string;
  city: string;
  state: string;
}

export function neighborhoodWelcomeTemplate(
  options: NeighborhoodWelcomeEmailOptions,
): string {
  const recipientName = options.recipientName?.trim();

  const greeting = recipientName
    ? `Hello ${escapeHtml(recipientName)},`
    : 'Hello,';

  const neighborhoodName = escapeHtml(options.neighborhoodName);
  const city = escapeHtml(options.city);
  const state = escapeHtml(options.state);

  return baseEmailLayout({
    title: 'Welcome to your neighborhood!',
    preheader: `You have joined ${options.neighborhoodName} on AdugboHub.`,
    content: `
      <h2 style="margin:0 0 18px;color:#252238;font-size:23px;">
        Welcome to your neighborhood!
      </h2>

      <p style="margin:0 0 18px;">
        ${greeting}
      </p>

      <p style="margin:0 0 18px;">
        You have successfully joined
        <strong>${neighborhoodName}</strong>
        on AdugboHub.
      </p>

      <div style="
        margin:24px 0;
        padding:20px;
        background:#f8f5ff;
        border-radius:12px;
      ">
        <p style="margin:0 0 8px;color:#777;font-size:12px;">
          YOUR NEIGHBORHOOD
        </p>

        <p style="margin:0;color:#252238;font-size:18px;font-weight:bold;">
          ${neighborhoodName}
        </p>

        <p style="margin:8px 0 0;color:#666;font-size:14px;">
          ${city}, ${state}
        </p>
      </div>

      <p style="margin:0 0 18px;">
        Stay informed, connect with residents, discover local services,
        and participate in your community.
      </p>

      <p style="margin:0;">
        Thank you for being part of AdugboHub!
      </p>
    `,
  });
}