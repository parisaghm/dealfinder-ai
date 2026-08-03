import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchExplanationPanel } from './MatchExplanationPanel';

const IDENTIFIERS = {
  gtin: '04548736132443',
  ean: '4548736132443',
  mpn: null,
  modelNumber: 'WH1000XM5',
};

const REASONS = [
  {
    key: 'identifier',
    label: 'Identifier',
    detail: 'Both listings publish GTIN 04548736132443.',
    weight: 40,
    score: 100,
  },
  {
    key: 'brand',
    label: 'Brand',
    detail: 'Both listings are branded sony.',
    weight: 20,
    score: 100,
  },
];

const renderPanel = (props: Partial<Parameters<typeof MatchExplanationPanel>[0]> = {}) =>
  render(
    <MatchExplanationPanel
      score={96}
      confidence="HIGH"
      reasons={REASONS}
      conflicts={[]}
      identifiers={IDENTIFIERS}
      {...props}
    />,
  );

describe('MatchExplanationPanel', () => {
  it('states the confidence in words, not only as a number', () => {
    renderPanel();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
  });

  it('gives every reason as a checkable sentence', () => {
    renderPanel();
    expect(screen.getByText('Both listings publish GTIN 04548736132443.')).toBeInTheDocument();
    expect(screen.getByText('Both listings are branded sony.')).toBeInTheDocument();
  });

  /**
   * The rule this panel exists to enforce.
   *
   * A conflicting attribute is the reader's best reason to distrust a grouping.
   * Putting it below four green ticks, or behind a disclosure, would be a way
   * of technically disclosing it while practically hiding it.
   */
  it('shows conflicts even when the reasons are plentiful', () => {
    renderPanel({
      conflicts: [
        {
          key: 'variant:generation',
          label: 'Generation',
          detail: 'Generation differs: 1 versus 2.',
          severity: 'REVIEWABLE',
        },
      ],
    });

    expect(screen.getByText(/points against this grouping/i)).toBeInTheDocument();
    expect(screen.getByText(/Generation differs: 1 versus 2\./)).toBeInTheDocument();
  });

  it('surfaces non-blocking variant differences alongside the conflicts', () => {
    renderPanel({
      variantNotes: ['Colour differs between stores: Black (Gigantti) · White (Power).'],
    });
    expect(screen.getByText(/Colour differs between stores/)).toBeInTheDocument();
  });

  it('omits the conflict block entirely when there is nothing against', () => {
    renderPanel();
    expect(screen.queryByText(/points against this grouping/i)).not.toBeInTheDocument();
  });

  it('lists the identifiers, and says when one was not published', () => {
    renderPanel();
    expect(screen.getByText('04548736132443')).toBeInTheDocument();
    expect(screen.getByText('WH1000XM5')).toBeInTheDocument();
    // A missing identifier is information; an omitted row would read as a bug.
    expect(screen.getByText('Not published')).toBeInTheDocument();
  });

  it('admits that a grouping without an identifier is a judgement', () => {
    renderPanel({ confidence: 'MEDIUM' });
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText(/a judgement, not a fact/i)).toBeInTheDocument();
  });
});
