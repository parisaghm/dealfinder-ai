import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * Card — the primary surface. Rounded, one hairline border, one soft shadow.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts slightly on hover. Only for cards that are themselves a link. */
  interactive?: boolean;
  padded?: boolean;
}

export function Card({ interactive, padded = true, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface shadow-card',
        padded && 'p-5',
        interactive && 'transition-shadow duration-150 hover:shadow-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface SectionHeadingProps {
  title: string;
  description?: string;
  /** Right-aligned control, e.g. a "view all" link. */
  action?: ReactNode;
  /** Heading level, so page structure stays correct for screen readers. */
  as?: 'h2' | 'h3';
  className?: string;
}

export function SectionHeading({
  title,
  description,
  action,
  as: Tag = 'h2',
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        <Tag className={Tag === 'h2' ? 'text-lg' : 'text-base'}>{title}</Tag>
        {description && <p className="text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
