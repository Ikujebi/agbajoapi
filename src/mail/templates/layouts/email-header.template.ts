export interface EmailHeaderOptions {
  brandName: string;
  logoUrl?: string | null;
  websiteUrl?: string;
  primaryColor?: string;
  headerBackground?: string;
  logoAlt?: string;
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

export function emailHeader(options: EmailHeaderOptions): string {
  const brandName = escapeHtml(options.brandName);

  const logoUrl = safeUrl(options.logoUrl);
  const websiteUrl = safeUrl(options.websiteUrl);

  const primaryColor = safeColor(
    options.primaryColor,
    '#D92D45',
  );

  const headerBackground = safeColor(
    options.headerBackground,
    '#190021',
  );

  const logoAlt = escapeHtml(
    options.logoAlt || `${options.brandName} logo`,
  );

  const logoContent = logoUrl
    ? `
      <img
        src="${logoUrl}"
        alt="${logoAlt}"
        width="240"
        style="
          display:block;
          width:240px;
          max-width:100%;
          height:auto;
          margin:0 auto;
          border:0;
          outline:none;
          text-decoration:none;
        "
      />
    `
    : `
      <span style="
        display:inline-block;
        color:#FFFFFF;
        font-size:24px;
        line-height:32px;
        font-weight:700;
      ">
        ${brandName}
      </span>
    `;

  const logo = websiteUrl
    ? `
      <a
        href="${websiteUrl}"
        target="_blank"
        style="
          display:inline-block;
          text-decoration:none;
        "
      >
        ${logoContent}
      </a>
    `
    : logoContent;

  return `
    <tr>
      <td
        align="center"
        style="
          padding:24px;
          background:${headerBackground};
          border-bottom:3px solid ${primaryColor};
          text-align:center;
        "
      >
        ${logo}

        <p style="
          margin:10px 0 0;
          color:#FFFFFF;
          font-size:11px;
          line-height:18px;
          letter-spacing:2px;
          text-transform:uppercase;
        ">
          ${brandName}
        </p>
      </td>
    </tr>
  `.trim();
}