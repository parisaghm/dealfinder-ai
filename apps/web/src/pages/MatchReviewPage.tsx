import {
  MATCH_CANDIDATE_STATUSES,
  MATCH_CONFIDENCES,
  type MatchCandidateStatus,
  type MatchConfidence,
} from '@deal-finder/shared';
import { EmptyState, ErrorState, Field, LoadingIndicator, Select } from '@deal-finder/ui';
import { AlertTriangle, Inbox } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MatchCandidateReview } from '../components/admin/MatchCandidateReview';
import {
  useApproveMatchCandidate,
  useMatchCandidates,
  useRejectMatchCandidate,
} from '../lib/queries';

/**
 * The match-review queue — an internal tool.
 *
 * Not in the main navigation, and labelled as internal at the top of the page,
 * because a decision made here changes what every visitor sees on search and
 * comparison. Putting it beside "Watchlist" would misrepresent both what it is
 * and who it is for.
 *
 * It exists because the matcher deliberately refuses to merge anything it is
 * unsure about. That refusal is only safe if the uncertain cases go somewhere a
 * person will actually look, which makes this page part of the safety
 * mechanism rather than an administrative convenience.
 */

const STATUS_LABELS: Record<MatchCandidateStatus, string> = {
  PENDING: 'Awaiting review',
  AI_CONFIRMED: 'AI-endorsed, awaiting review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
};

const CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

function isStatus(value: string | null): value is MatchCandidateStatus {
  return value != null && (MATCH_CANDIDATE_STATUSES as readonly string[]).includes(value);
}

function isConfidence(value: string | null): value is MatchConfidence {
  return value != null && (MATCH_CONFIDENCES as readonly string[]).includes(value);
}

export function MatchReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);

  const status: MatchCandidateStatus = isStatus(searchParams.get('status'))
    ? (searchParams.get('status') as MatchCandidateStatus)
    : 'PENDING';
  const confidence = isConfidence(searchParams.get('confidence'))
    ? (searchParams.get('confidence') as MatchConfidence)
    : undefined;

  const candidates = useMatchCandidates({ status, confidence, limit: 20 });
  const approve = useApproveMatchCandidate();
  const reject = useRejectMatchCandidate();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: false });
  };

  const onError = (error: unknown) =>
    setActionError(error instanceof Error ? error.message : 'That decision could not be saved.');

  const pendingFor = (id: string): 'approve' | 'reject' | null => {
    if (approve.isPending && approve.variables?.id === id) return 'approve';
    if (reject.isPending && reject.variables?.id === id) return 'reject';
    return null;
  };

  const items = candidates.data?.items ?? [];
  const counts = candidates.data?.counts;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Match review</h1>

        <div
          className="flex gap-2 rounded-lg bg-warn-50 p-3 ring-1 ring-warn-200"
          role="note"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn-800" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-warn-800">
            <strong className="font-semibold">Internal MVP tool.</strong> Decisions made here change
            what every visitor sees on the search and comparison pages. This is not part of the
            public product, and there is no undo beyond re-running the match for a listing.
          </p>
        </div>

        <p className="text-sm text-ink-500">
          These listings look like products we already know about, but not clearly enough for the
          matcher to group them on its own. Anything it was sure about was grouped without asking;
          anything with a conflicting specification was rejected outright and never reached this
          queue.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Field label="Status" className="w-56">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={status}
              onChange={(event) => setParam('status', event.target.value)}
            >
              {MATCH_CANDIDATE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                  {option === 'PENDING' && counts ? ` (${counts.pending})` : ''}
                  {option === 'APPROVED' && counts ? ` (${counts.approved})` : ''}
                  {option === 'REJECTED' && counts ? ` (${counts.rejected})` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Confidence" className="w-44">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={confidence ?? ''}
              onChange={(event) => setParam('confidence', event.target.value)}
            >
              <option value="">Any</option>
              {MATCH_CONFIDENCES.map((option) => (
                <option key={option} value={option}>
                  {CONFIDENCE_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {actionError && (
        <p className="text-sm font-medium text-rise-700" role="alert">
          {actionError}
        </p>
      )}

      {candidates.isPending && <LoadingIndicator label="Loading the review queue" />}

      {candidates.isError && (
        <ErrorState
          message={
            candidates.error instanceof Error
              ? candidates.error.message
              : 'The review queue could not be loaded.'
          }
          onRetry={() => void candidates.refetch()}
        />
      )}

      {candidates.data && items.length === 0 && (
        <EmptyState
          icon={<Inbox className="size-8" aria-hidden="true" />}
          title="Nothing to review"
          description="No listings currently match this filter. Every offer the matcher was unsure about has been dealt with."
        />
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((candidate) => (
            <li key={candidate.id}>
              <MatchCandidateReview
                candidate={candidate}
                pending={pendingFor(candidate.id)}
                onApprove={(id) => {
                  setActionError(null);
                  approve.mutate({ id }, { onError });
                }}
                onReject={(id) => {
                  setActionError(null);
                  reject.mutate({ id }, { onError });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
