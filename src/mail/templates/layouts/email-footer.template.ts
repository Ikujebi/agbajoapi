export interface EmailFooterOptions {
  brandName: string;
  footerText?: string;
  unsubscribeUrl?: string;
  websiteUrl?: string;
  secondaryColor?: string;
  mutedColor?: string;
  borderColor?: string;
  poweredByText?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

function safeUrl(value?: string | null): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'https:') {
      return '';
    }

    return escapeHtml(url.toString());
  } catch {
    return '';
  }
}

function safeColor(
  value: string | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();

  return /^#[0-9A-Fa-f]{6}$/.test(normalized)
    ? normalized
    : fallback;
}

function getWebsiteLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function emailFooter(options: EmailFooterOptions): string {
  const brandName = escapeHtml(options.brandName);

  const footerText = escapeHtml(
    options.footerText ||
      `You are receiving this email because you have an account or relationship with ${options.brandName}.`,
  );

  const websiteUrl = safeUrl(options.websiteUrl);
  const unsubscribeUrl = safeUrl(options.unsubscribeUrl);

  const secondaryColor = safeColor(
    options.secondaryColor,
    '#7137A8',
  );

  const mutedColor = safeColor(
    options.mutedColor,
    '#777487',
  );

  const borderColor = safeColor(
    options.borderColor,
    '#E9E7EF',
  );

  const websiteLabel = options.websiteUrl
    ? escapeHtml(getWebsiteLabel(options.websiteUrl))
    : '';

  const unsubscribeLink = unsubscribeUrl
    ? `
      <p style="
        margin:16px 0 0;
        font-size:12px;
        line-height:20px;
      ">
        <a
          href="${unsubscribeUrl}"
          style="
            color:${secondaryColor};
            text-decoration:underline;
          "
        >
          Unsubscribe
        </a>
      </p>
    `
    : '';

  const websiteLink =
    websiteUrl && websiteLabel
      ? `
        <p style="
          margin:8px 0 0;
          font-size:12px;
          line-height:20px;
        ">
          <a
            href="${websiteUrl}"
            target="_blank"
            style="
              color:${secondaryColor};
              text-decoration:none;
              font-weight:600;
            "
          >
            ${websiteLabel}
          </a>
        </p>
      `
      : '';

  const poweredBy = options.poweredByText
    ? `
      <p style="
        margin:12px 0 0;
        color:${mutedColor};
        font-size:11px;
        line-height:18px;
      ">
        ${escapeHtml(options.poweredByText)}
      </p>
    `
    : '';

  return `
    <tr>
      <td
        align="center"
        style="
          padding:26px 32px;
          background:#FAF9FC;
          border-top:1px solid ${borderColor};
          text-align:center;
        "
      >
        <p style="
          margin:0;
          color:${mutedColor};
          font-size:12px;
          line-height:20px;
        ">
          ${footerText}
        </p>

        ${unsubscribeLink}

        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            margin:20px 0;
            border-collapse:collapse;
          "
        >
          <tr>
            <td
              height="1"
              style="
                height:1px;
                background:${borderColor};
                font-size:0;
                line-height:0;
              "
            >
              &nbsp;
            </td>
          </tr>
        </table>

        <p style="
          margin:0;
          color:${mutedColor};
          font-size:12px;
          line-height:20px;
        ">
          &copy; ${new Date().getFullYear()}
          ${brandName}.
          All rights reserved.
        </p>

        ${websiteLink}

        ${poweredBy}
      </td>
    </tr>
  `.trim();
}