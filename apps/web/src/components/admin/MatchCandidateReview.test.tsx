import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeMatchCandidate } from '../../test/factories';
import { MatchCandidateReview } from './MatchCandidateReview';

const renderReview = (props: Partial<Parameters<typeof MatchCandidateReview>[0]> = {}) =>
  render(
    <MatchCandidateReview
      candidate={makeMatchCandidate()}
      onApprove={vi.fn()}
      onReject={vi.fn()}
      pending={null}
      {...props}
    />,
  );

describe('MatchCandidateReview', () => {
  it('shows both sides, labelled', () => {
    renderReview();
    expect(screen.getByRole('heading', { name: /source listing/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /candidate match/i })).toBeInTheDocument();
  });

  it('shows the score and states the confidence in words', () => {
    renderReview();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
  });

  it('gives both images real alt text', () => {
    renderReview();
    expect(screen.getByAltText(/Samsung QE65Q70DATXXC/)).toBeInTheDocument();
    expect(screen.getByAltText(/Samsung 65" QLED Q70D/)).toBeInTheDocument();
  });

  it('shows the identifiers each side publishes, and says when one publishes none', () => {
    renderReview();
    expect(screen.getByText('QE65Q70DATXXC')).toBeInTheDocument();
    expect(screen.getByText('Q70D')).toBeInTheDocument();
    expect(screen.getAllByText('Not published').length).toBeGreaterThan(0);
  });

  // A reviewer scanning quickly must not depend on hue to spot the difference.
  it('marks a differing specification with a word, not only a colour', () => {
    renderReview();
    expect(screen.getAllByText('(differs)').length).toBeGreaterThan(0);
  });

  it('does not mark a specification the two sides agree on', () => {
    const candidate = makeMatchCandidate();
    renderReview({
      candidate: {
        ...candidate,
        sourceProduct: { ...candidate.sourceProduct, specifications: { 'Screen size': '65"' } },
        candidateCanonicalProduct: {
          ...candidate.candidateCanonicalProduct,
          specifications: { 'Screen size': '65"' },
        },
      },
    });
    expect(screen.queryByText('(differs)')).not.toBeInTheDocument();
  });

  // The evidence against is the reviewer's reason to say no, so it is never
  // collapsed or ranked below the evidence for.
  it('shows the points against alongside the points for', () => {
    renderReview();
    expect(screen.getByText(/points against/i)).toBeInTheDocument();
    expect(screen.getByText(/Model numbers disagree/)).toBeInTheDocument();
    expect(screen.getByText(/points for/i)).toBeInTheDocument();
    expect(screen.getByText(/Both listings are branded samsung/)).toBeInTheDocument();
  });

  it('reports a decision with the candidate id', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    renderReview({ onApprove, onReject });

    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(onApprove).toHaveBeenCalledWith('candidate-1');

    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onReject).toHaveBeenCalledWith('candidate-1');
  });

  it('disables both decisions while one is in flight', () => {
    renderReview({ pending: 'approve' });
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeDisabled();
  });

  it('links out to the source listing in a new tab', () => {
    renderReview();
    const link = screen.getByRole('link', { name: /open the source listing/i });
    expect(link).toHaveAttribute('href', 'https://verkkokauppa.test/p/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('says how many offers the candidate group already has', () => {
    renderReview();
    const pane = screen.getByRole('heading', { name: /candidate match/i }).parentElement;
    expect(pane).not.toBeNull();
    expect(within(pane!).getByText(/currently 1 offer/i)).toBeInTheDocument();
  });
});
