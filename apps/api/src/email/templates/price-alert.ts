import { formatMoney, type Currency } from '@deal-finder/shared';
import { env } from '../../env';

/**
 * The price-alert email.
 *
 * Written as inline-styled, table-based HTML with a full plain-text
 * alternative, because email clients do not support external stylesheets,
 * flexbox or modern CSS. Every value is escaped before interpolation: product
 * names come from third-party stores and must never be able to inject markup
 * into a message we send.
 */

export interface PriceAlertEmailInput {
  productName: string;
  storeName: string;
  productUrl: string;
  currency: Currency;
  currentPrice: number;
  previousPrice: number | null;
  targetPrice: number | null;
  originalPrice: number | null;
  discountPercent: number;
  /** Used to build the pause/unsubscribe link. */
  watchlistItemId: string | null;
  recipientName?: string | null;
  /** Set for `POST /api/alerts/test`, which adds a banner. */
  isTest?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only allow http(s) URLs through into an anchor, so a malicious productUrl
 * cannot become a `javascript:` link.
 */
function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // fall through
  }
  return env.APP_URL;
}

const COLORS = {
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#0f766e',
  drop: '#047857',
  surface: '#f9fafb',
};

export function renderPriceAlertEmail(input: PriceAlertEmailInput): RenderedEmail {
  const money = (value: number) => formatMoney(value, input.currency);

  const productName = escapeHtml(input.productName);
  const storeName = escapeHtml(input.storeName);
  const productUrl = safeUrl(input.productUrl);

  // Placeholder pause link. Real unsubscribe requires a signed token, which
  // arrives with production authentication — see docs/architecture.md.
  const pauseUrl = input.watchlistItemId
    ? `${env.APP_URL}/watchlist?pause=${encodeURIComponent(input.watchlistItemId)}&token=PLACEHOLDER_UNSUBSCRIBE_TOKEN`
    : `${env.APP_URL}/settings`;

  const dropAmount =
    input.previousPrice != null && input.previousPrice > input.currentPrice
      ? input.previousPrice - input.currentPrice
      : null;

  const subject = input.isTest
    ? `[Test] Price alert for ${input.productName}`
    : input.targetPrice != null
      ? `${input.productName} is now ${money(input.currentPrice)} — your target was ${money(input.targetPrice)}`
      : `${input.productName} dropped to ${money(input.currentPrice)}`;

  const rows: Array<[string, string]> = [
    ['Store', storeName],
    ['Current price', money(input.currentPrice)],
  ];
  if (input.previousPrice != null) rows.push(['Previous price', money(input.previousPrice)]);
  if (input.targetPrice != null) rows.push(['Your target price', money(input.targetPrice)]);
  if (input.originalPrice != null) rows.push(['Store’s original price', money(input.originalPrice)]);
  if (input.discountPercent > 0) rows.push(['Discount', `${Math.round(input.discountPercent)}% off`]);

  const rowsHtml = rows
    .map(
      ([label, value]) => `
            <tr>
              <td style="padding:8px 0;color:${COLORS.muted};font-size:14px;">${escapeHtml(label)}</td>
              <td style="padding:8px 0;color:${COLORS.text};font-size:14px;font-weight:600;text-align:right;">${escapeHtml(value)}</td>
            </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:${COLORS.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${COLORS.text};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${COLORS.border};border-radius:12px;">
    <tr>
      <td style="padding:24px 24px 8px 24px;">
        <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${COLORS.accent};">
          DealFinder AI
        </p>
      </td>
    </tr>
    ${
      input.isTest
        ? `<tr><td style="padding:0 24px;"><p style="margin:8px 0;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e;">This is a test alert, sent from your settings page. No price actually changed.</p></td></tr>`
        : ''
    }
    <tr>
      <td style="padding:8px 24px 0 24px;">
        <h1 style="margin:0 0 8px 0;font-size:20px;line-height:1.35;">${productName}</h1>
        <p style="margin:0;font-size:15px;color:${COLORS.muted};">
          ${
            input.targetPrice != null
              ? `It reached <strong style="color:${COLORS.drop};">${escapeHtml(money(input.currentPrice))}</strong>, at or below your ${escapeHtml(money(input.targetPrice))} target.`
              : `It dropped to <strong style="color:${COLORS.drop};">${escapeHtml(money(input.currentPrice))}</strong>.`
          }
          ${dropAmount != null ? `That is ${escapeHtml(money(dropAmount))} less than when we last checked.` : ''}
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px 0 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${COLORS.border};">
          ${rowsHtml}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px 4px 24px;">
        <a href="${productUrl}" style="display:inline-block;padding:12px 20px;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
          View the deal at ${storeName}
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px 24px 24px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
          Prices change often and may already differ — always confirm on the store's own page before buying.
          This is an automated alert, not a recommendation.
          <br />
          <a href="${pauseUrl}" style="color:${COLORS.muted};text-decoration:underline;">Pause alerts for this product</a>
          &nbsp;·&nbsp;
          <a href="${env.APP_URL}/settings" style="color:${COLORS.muted};text-decoration:underline;">Notification settings</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    'DEALFINDER AI',
    input.isTest ? '\n[TEST ALERT] No price actually changed.\n' : '',
    '',
    input.productName,
    '',
    input.targetPrice != null
      ? `Now ${money(input.currentPrice)} — at or below your target of ${money(input.targetPrice)}.`
      : `Now ${money(input.currentPrice)}.`,
    dropAmount != null ? `Down ${money(dropAmount)} since the last check.` : '',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `View the deal: ${productUrl}`,
    '',
    'Prices change often and may already differ — always confirm on the store’s own page before buying.',
    'This is an automated alert, not a recommendation.',
    '',
    `Pause alerts for this product: ${pauseUrl}`,
    `Notification settings: ${env.APP_URL}/settings`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { subject, html, text };
}
