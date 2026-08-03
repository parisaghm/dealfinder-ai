import type { DealQuality, DealQualityLabel } from '@deal-finder/shared';
import { Badge, type BadgeTone } from '@deal-finder/ui';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleMinus, Sparkles } from 'lucide-react';

/**
 * The deal-quality label.
 *
 * The score is never shown alone. A bare "41/100" invites false precision, so
 * the badge carries a plain-language label and the details page shows the
 * factors behind it. Confidence is surfaced too: "Excellent" from two
 * observations does not deserve the same weight as "Excellent" from ninety.
 */

const LABEL_TEXT: Record<DealQualityLabel, string> = {
  EXCELLENT: 'Excellent deal',
  GOOD: 'Good deal',
  AVERAGE: 'Average price',
  PRICE_INCREASED: 'Price increased',
};

const LABEL_TONE: Record<DealQualityLabel, BadgeTone> = {
  EXCELLENT: 'drop',
  GOOD: 'accent',
  AVERAGE: 'neutral',
  PRICE_INCREASED: 'rise',
};

const LABEL_ICON: Record<DealQualityLabel, typeof Sparkles> = {
  EXCELLENT: Sparkles,
  GOOD: ArrowDownRight,
  AVERAGE: CircleMinus,
  PRICE_INCREASED: ArrowUpRight,
};

export interface DealQualityBadgeProps {
  quality: DealQuality;
  size?: 'sm' | 'md';
  showScore?: boolean;
}

export function DealQualityBadge({ quality, size = 'sm', showScore = false }: DealQualityBadgeProps) {
  const Icon = LABEL_ICON[quality.label];

  return (
    <Badge
      tone={LABEL_TONE[quality.label]}
      size={size}
      icon={<Icon className="size-3" aria-hidden="true" />}
    >
      {LABEL_TEXT[quality.label]}
      {showScore && <span className="tabular font-normal opacity-70">{quality.score}/100</span>}
    </Badge>
  );
}

/**
 * Warning shown when recorded history contradicts the store's crossed-out
 * price — the single most important thing this product has to say.
 */
export function FakeDiscountWarning({ quality }: { quality: DealQuality }) {
  if (quality.claimedDiscountTrustworthy || quality.warnings.length === 0) return null;

  return (
    <div className="flex gap-2 rounded-lg border border-warn-200 bg-warn-50 p-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn-800" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-warn-800">
          This discount does not match our price records
        </p>
        <ul className="flex flex-col gap-1">
          {quality.warnings.map((warning) => (
            <li key={warning} className="text-xs leading-relaxed text-warn-800/90">
              {warning}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Compact "based on N checks" note. */
export function ConfidenceNote({ quality }: { quality: DealQuality }) {
  const text =
    quality.confidence === 'HIGH'
      ? 'Based on a long price history'
      : quality.confidence === 'MEDIUM'
        ? 'Based on a limited price history'
        : 'Based on very little price history so far';

  return <span className="text-xs text-ink-500">{text}</span>;
}
