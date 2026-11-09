interface VisitorPassTemplateOptions {
  visitorName: string;
  hostName: string;
  estateName: string;
  code: string;
  validUntil: Date;
  directionsUrl: string | null;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[char];
  });

const formatLagos = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

export const visitorPassTemplate = (
  options: VisitorPassTemplateOptions,
): string => {
  const visitorName = escapeHtml(options.visitorName);
  const hostName = escapeHtml(options.hostName);
  const estateName = escapeHtml(options.estateName);
  const code = escapeHtml(options.code);
  const validUntil = escapeHtml(formatLagos(options.validUntil));

  const directionsUrl = options.directionsUrl
    ? escapeHtml(options.directionsUrl)
    : null;

  const directionsSection = directionsUrl
    ? `
      <tr>
        <td align="center" style="padding:24px 0 12px;">
          <a
            href="${directionsUrl}"
            style="
              display:inline-block;
              padding:13px 24px;
              background-color:#c62828;
              color:#ffffff;
              font-size:14px;
              font-weight:700;
              text-decoration:none;
              border-radius:8px;
            "
          >
            View visitor directions
          </a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:0 24px 20px;">
          <p style="margin:0;color:#64748b;font-size:12px;line-height:20px;">
            If the button doesn't work, copy this link:
          </p>
          <a
            href="${directionsUrl}"
            style="color:#7c3aed;font-size:12px;word-break:break-all;"
          >
            ${directionsUrl}
          </a>
        </td>
      </tr>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Your visitor pass</title>
      </head>

      <body style="
        margin:0;
        padding:24px 12px;
        background-color:#f8fafc;
        font-family:Arial,Helvetica,sans-serif;
        color:#172033;
      ">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="max-width:560px;margin:0 auto;"
        >
          <tr>
            <td align="center" style="padding:12px 0 24px;">
              <span style="
                font-size:23px;
                font-weight:800;
                letter-spacing:-0.5px;
                color:#c62828;
              ">
                AdugboHub
              </span>
            </td>
          </tr>

          <tr>
            <td style="
              background-color:#ffffff;
              border:1px solid #e8edf3;
              border-radius:14px;
              overflow:hidden;
            ">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td style="
                    padding:28px 28px 20px;
                    background-color:#fff7f7;
                    border-bottom:1px solid #fce7e7;
                  ">
                    <p style="
                      margin:0 0 8px;
                      color:#c62828;
                      font-size:12px;
                      font-weight:700;
                      text-transform:uppercase;
                      letter-spacing:1px;
                    ">
                      Visitor invitation
                    </p>

                    <h1 style="
                      margin:0;
                      color:#172033;
                      font-size:24px;
                      line-height:32px;
                    ">
                      You're expected at ${estateName}
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding:28px;">
                    <p style="
                      margin:0 0 16px;
                      font-size:15px;
                      line-height:24px;
                    ">
                      Hello ${visitorName},
                    </p>

                    <p style="
                      margin:0 0 20px;
                      color:#475569;
                      font-size:14px;
                      line-height:24px;
                    ">
                      ${hostName} has invited you to visit
                      <strong>${estateName}</strong>.
                      Please present your visitor pass code to security
                      at the estate gate.
                    </p>

                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="
                        background-color:#f8fafc;
                        border:1px dashed #cbd5e1;
                        border-radius:12px;
                      "
                    >
                      <tr>
                        <td align="center" style="padding:22px 12px;">
                          <p style="
                            margin:0 0 10px;
                            color:#64748b;
                            font-size:11px;
                            font-weight:700;
                            text-transform:uppercase;
                            letter-spacing:1.5px;
                          ">
                            Your visitor pass code
                          </p>

                          <p style="
                            margin:0;
                            color:#c62828;
                            font-size:32px;
                            font-weight:800;
                            letter-spacing:6px;
                          ">
                            ${code}
                          </p>
                        </td>
                      </tr>
                    </table>

                    <p style="
                      margin:22px 0 0;
                      color:#64748b;
                      font-size:13px;
                      line-height:22px;
                    ">
                      <strong style="color:#172033;">Valid until:</strong>
                      ${validUntil} (WAT)
                    </p>
                  </td>
                </tr>

                ${directionsSection}

                <tr>
                  <td style="
                    padding:20px 28px;
                    background-color:#f8fafc;
                    border-top:1px solid #e8edf3;
                  ">
                    <p style="
                      margin:0;
                      color:#64748b;
                      font-size:12px;
                      line-height:20px;
                      text-align:center;
                    ">
                      This visitor pass was shared with you through
                      AdugboHub. Please do not share your pass code with
                      anyone else.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 12px;">
              <p style="
                margin:0;
                color:#94a3b8;
                font-size:11px;
              ">
                AdugboHub — Your neighbourhood, better connected.
              </p>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};