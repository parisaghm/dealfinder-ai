import type { CanonicalIdentifiers, MatchConflictDto, MatchReasonDto } from '@deal-finder/shared';
import { Badge, Card } from '@deal-finder/ui';
import { AlertTriangle, Info } from 'lucide-react';

/**
 * Why these listings were grouped.
 *
 * A structural sibling of `DealQualityExplainer`, deliberately not a reuse of
 * it: the two answer different questions and their inputs share no shape.
 *
 * One rule this panel enforces that the deal-quality one does not need:
 * **conflicts render above the reasons and are never collapsed.** A conflicting
 * attribute is the reader's single best reason to distrust a grouping, and
 * putting it behind a disclosure — below four green ticks — would be a way of
 * technically disclosing it while practically hiding it.
 */

const CONFIDENCE_COPY = {
  HIGH: {
    tone: 'drop' as const,
    label: 'High confidence',
    detail: 'These listings publish evidence that identifies them as the same product.',
  },
  MEDIUM: {
    tone: 'warn' as const,
    label: 'Medium confidence',
    detail: 'At least one listing was grouped on a judgement rather than a published code.',
  },
  LOW: {
    tone: 'rise' as const,
    label: 'Low confidence',
    detail: 'The evidence for this grouping is weak.',
  },
};

export interface MatchExplanationPanelProps {
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: readonly MatchReasonDto[];
  conflicts: readonly MatchConflictDto[];
  identifiers: CanonicalIdentifiers;
  /** Non-blocking differences between the grouped offers. */
  variantNotes?: readonly string[];
}

export function MatchExplanationPanel({
  score,
  confidence,
  reasons,
  conflicts,
  identifiers,
  variantNotes = [],
}: MatchExplanationPanelProps) {
  const copy = CONFIDENCE_COPY[confidence];

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base">Why we think these are the same product</h2>
          <p className="text-sm text-ink-500">{copy.detail}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {/* Confidence in words, never a bare number. */}
          <Badge tone={copy.tone} size="md">
            {copy.label}
          </Badge>
          {score > 0 && (
            <span className="text-xs text-ink-400">
              <span className="font-semibold tabular text-ink-700">{score}</span>/100
            </span>
          )}
        </div>
      </div>

      {/* Above the reasons, always. */}
      {(conflicts.length > 0 || variantNotes.length > 0) && (
        <div className="flex flex-col gap-2 rounded-lg bg-warn-50 p-3 ring-1 ring-warn-200">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warn-800">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Points against this grouping
          </span>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-warn-800">
            {conflicts.map((conflict) => (
              <li key={conflict.key}>
                <span className="font-medium">{conflict.label}:</span> {conflict.detail}
              </li>
            ))}
            {variantNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {reasons.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-t border-line">
          {reasons.map((reason) => (
            <li key={reason.key} className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink-900">{reason.label}</span>
                <span className="shrink-0 text-xs text-ink-400">weight {reason.weight}%</span>
              </div>
              <p className="text-xs leading-relaxed text-ink-500">{reason.detail}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="text-xs font-semibold text-ink-700">Product identifiers</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <Identifier label="GTIN" value={identifiers.gtin} />
          <Identifier label="EAN" value={identifiers.ean} />
          <Identifier label="MPN" value={identifiers.mpn} />
          <Identifier label="Model number" value={identifiers.modelNumber} />
        </dl>
      </div>

      <div className="flex gap-2 rounded-lg bg-surface-muted p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-ink-500">
          Matching is automated. Offers are grouped on published identifiers where stores provide
          them, and otherwise on brand, model number and product name. Where no identifier exists
          the grouping is a judgement, not a fact — and one you can disagree with.
        </p>
      </div>
    </Card>
  );
}

function Identifier({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col">
      <dt className="text-ink-400">{label}</dt>
      {/* An absent identifier says so rather than vanishing: "no EAN published"
          is information, and a missing row would read as a rendering bug. */}
      <dd className={value ? 'font-medium tabular text-ink-700' : 'text-ink-400'}>
        {value ?? 'Not published'}
      </dd>
    </div>
  );
}
