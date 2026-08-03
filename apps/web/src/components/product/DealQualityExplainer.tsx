import type { DealQuality } from '@deal-finder/shared';
import { Card } from '@deal-finder/ui';
import { Info } from 'lucide-react';
import { DealQualityBadge, FakeDiscountWarning } from '../deals/DealQualityBadge';

/**
 * The full deal-quality breakdown.
 *
 * The score is shown *with every factor that produced it*, each as a sentence
 * the reader can verify against the chart above. That is the difference between
 * a number a user has to take on faith and an argument they can check — and it
 * is why the disclaimer can be honest rather than defensive.
 */
export function DealQualityExplainer({ quality }: { quality: DealQuality }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base">Is this actually a good deal?</h2>
          <p className="text-sm text-ink-500">{quality.headline}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <DealQualityBadge quality={quality} size="md" />
          <span className="text-xs text-ink-400">
            <span className="font-semibold tabular text-ink-700">{quality.score}</span>/100
          </span>
        </div>
      </div>

      <FakeDiscountWarning quality={quality} />

      <ul className="flex flex-col divide-y divide-line border-t border-line">
        {quality.factors.map((factor) => (
          <li key={factor.key} className="flex flex-col gap-1.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink-900">{factor.label}</span>
              <span className="shrink-0 text-xs text-ink-400">
                weight {factor.weight}%
              </span>
            </div>

            <p className="text-xs leading-relaxed text-ink-500">{factor.detail}</p>

            {/* A meter, not a second colour: the track is a lighter step of the
                same hue so the state reads across the whole bar. */}
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-accent-50"
              role="img"
              aria-label={`${factor.label}: scores ${Math.round(factor.score)} out of 100`}
            >
              <div
                className="h-full rounded-full bg-accent-500"
                style={{ width: `${Math.max(1.5, factor.score)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 rounded-lg bg-surface-muted p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-ink-500">
          {quality.disclaimer}{' '}
          {quality.confidence === 'LOW'
            ? 'We have very little recorded history for this product so far, so treat this assessment with caution.'
            : quality.confidence === 'MEDIUM'
              ? 'This is based on a limited price history.'
              : 'This is based on a long recorded price history.'}
        </p>
      </div>
    </Card>
  );
}
