import { formatMoney, type Currency, type MatchCandidate } from '@deal-finder/shared';
import { Badge, Button, cn } from '@deal-finder/ui';
import { DealCta } from '../deals/DealCta';
import { AlertTriangle, ArrowRight, Check, ImageOff, X } from 'lucide-react';

/**
 * One proposed match, laid out for a decision.
 *
 * The layout is the argument: source listing on the left, candidate group on
 * the right, the score between them, and the evidence for and against
 * underneath. Everything a reviewer needs to disagree is on screen at once —
 * a review tool that requires clicking to see the conflict is a tool that
 * produces rubber-stamped approvals.
 *
 * Differing specifications are marked with a word, not only a colour, for the
 * same reason.
 */

export interface MatchCandidateReviewProps {
  candidate: MatchCandidate;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  pending: 'approve' | 'reject' | null;
}

export function MatchCandidateReview({
  candidate,
  onApprove,
  onReject,
  pending,
}: MatchCandidateReviewProps) {
  const source = candidate.sourceProduct;
  const target = candidate.candidateCanonicalProduct;
  const busy = pending !== null;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <SubjectPane
          heading="Source listing"
          name={source.name}
          imageUrl={source.imageUrl}
          identifiers={source.identifiers}
          specifications={source.specifications}
          otherSpecifications={target.specifications}
          footer={
            <span className="text-xs text-ink-500">
              {source.storeName} ·{' '}
              <span className="tabular">
                {formatMoney(source.currentPrice, source.currency as Currency)}
              </span>
            </span>
          }
        />

        <div className="flex flex-row items-center justify-center gap-3 lg:flex-col">
          <ArrowRight className="size-5 rotate-90 text-ink-400 lg:rotate-0" aria-hidden="true" />
          <div className="flex flex-col items-center">
            <Badge tone={candidate.confidence === 'HIGH' ? 'drop' : 'warn'} size="md">
              {candidate.confidence === 'HIGH' ? 'High confidence' : 'Medium confidence'}
            </Badge>
            <span className="mt-1 text-xs text-ink-400">
              <span className="font-semibold tabular text-ink-700">{candidate.score}</span>/100
            </span>
          </div>
        </div>

        <SubjectPane
          heading="Candidate match"
          name={target.name}
          imageUrl={target.imageUrl}
          identifiers={target.identifiers}
          specifications={target.specifications}
          otherSpecifications={source.specifications}
          footer={
            <span className="text-xs text-ink-500">
              Currently {target.offerCount} {target.offerCount === 1 ? 'offer' : 'offers'}
            </span>
          }
        />
      </div>

      {candidate.explanation.conflicts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-warn-50 p-3 ring-1 ring-warn-200">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warn-800">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            Points against
          </span>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-warn-800">
            {candidate.explanation.conflicts.map((conflict) => (
              <li key={conflict.key}>{conflict.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {candidate.explanation.reasons.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-700">Points for</span>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-ink-500">
            {candidate.explanation.reasons.map((reason) => (
              <li key={reason.key}>{reason.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button
          size="sm"
          loading={pending === 'approve'}
          disabled={busy}
          onClick={() => onApprove(candidate.id)}
          leadingIcon={<Check className="size-3.5" aria-hidden="true" />}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={pending === 'reject'}
          disabled={busy}
          onClick={() => onReject(candidate.id)}
          leadingIcon={<X className="size-3.5" aria-hidden="true" />}
        >
          Reject
        </Button>
        {/*
          Gated like every shopper-facing link. A reviewer sent to a fabricated URL
          learns nothing about whether the match is right, and the sample catalogue
          is what this screen is reviewed against in development.
        */}
        <DealCta
          offer={source}
          storeName={source.storeName}
          appearance="link"
          externalLabel="Open the source listing"
        />
      </div>
    </div>
  );
}

function SubjectPane({
  heading,
  name,
  imageUrl,
  identifiers,
  specifications,
  otherSpecifications,
  footer,
}: {
  heading: string;
  name: string;
  imageUrl: string | null;
  identifiers: { gtin: string | null; ean: string | null; mpn: string | null; modelNumber: string | null };
  specifications: Record<string, string>;
  otherSpecifications: Record<string, string>;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* Visible on every breakpoint, not just the stacked one: without it the
          two panes are only distinguishable by position. */}
      <h4 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{heading}</h4>

      <div className="flex gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={name} className="max-h-16 object-contain p-1" />
          ) : (
            <ImageOff className="size-5 text-ink-400" aria-hidden="true" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm leading-snug font-semibold text-ink-900">{name}</h3>
          {footer}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Entry label="GTIN" value={identifiers.gtin} />
        <Entry label="EAN" value={identifiers.ean} />
        <Entry label="MPN" value={identifiers.mpn} />
        <Entry label="Model" value={identifiers.modelNumber} />
        {Object.entries(specifications).map(([label, value]) => (
          <Entry
            key={label}
            label={label}
            value={value}
            differs={otherSpecifications[label] != null && otherSpecifications[label] !== value}
          />
        ))}
      </dl>
    </div>
  );
}

function Entry({
  label,
  value,
  differs = false,
}: {
  label: string;
  value: string | null;
  differs?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-ink-400">{label}</dt>
      <dd
        className={cn(
          'truncate',
          value == null ? 'text-ink-400' : 'text-ink-700',
          differs && 'font-semibold text-warn-800',
        )}
      >
        {value ?? 'Not published'}
        {/* A word, not only a colour. */}
        {differs && <span className="ml-1 font-normal">(differs)</span>}
      </dd>
    </div>
  );
}
