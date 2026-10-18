'use client';

import * as RTooltip from '@radix-ui/react-tooltip';
import * as RDialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Finding, Outcome } from '@/lib/engine/types';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-soft',
  secondary: 'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2 shadow-soft',
  ghost: 'text-text-2 hover:text-text hover:bg-bg-subtle',
  danger: 'bg-bad text-white hover:opacity-90',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,opacity] duration-150 disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        className={cx('inline-flex size-9 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-bg-subtle hover:text-text disabled:opacity-40', className)}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
}

export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[90] max-w-xs rounded-lg bg-text px-2.5 py-1.5 text-xs leading-snug text-bg shadow-pop">
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-surface-2 px-1.5 font-sans text-[11px] font-medium text-text-2">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-border bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[10px] font-medium transition-colors disabled:opacity-40',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]',
            value === o.value ? 'bg-surface text-text shadow-soft' : 'text-text-2 hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const FINDING_STYLE: Record<Finding | 'pending', { dot: string; text: string; soft: string; label: string }> = {
  matched: { dot: 'bg-ok', text: 'text-ok', soft: 'bg-ok-soft', label: 'Matched' },
  review: { dot: 'bg-warn', text: 'text-warn', soft: 'bg-warn-soft', label: 'Needs review' },
  mismatch: { dot: 'bg-bad', text: 'text-bad', soft: 'bg-bad-soft', label: 'Potential mismatch' },
  missing: { dot: 'bg-bad', text: 'text-bad', soft: 'bg-bad-soft', label: 'Missing' },
  unverified: { dot: 'bg-text-3', text: 'text-text-3', soft: 'bg-none-soft', label: 'Not verified' },
  pending: { dot: 'bg-border-strong', text: 'text-text-3', soft: 'bg-none-soft', label: 'Checking' },
};

export function FindingBadge({ finding, reviewed }: { finding: Finding | 'pending'; reviewed?: boolean }) {
  const s = FINDING_STYLE[finding];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', s.soft, s.text)}>
      <span className={cx('size-1.5 rounded-full', s.dot)} />
      {s.label}
      {reviewed && <span className="text-text-2">· reviewed</span>}
    </span>
  );
}

export const OUTCOME_STYLE: Record<Outcome, { text: string; soft: string; label: string }> = {
  clear: { text: 'text-ok', soft: 'bg-ok-soft', label: 'No issues found' },
  review: { text: 'text-warn', soft: 'bg-warn-soft', label: 'Needs review' },
  issues: { text: 'text-bad', soft: 'bg-bad-soft', label: 'Issues found' },
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px]" />
        <RDialog.Content
          className={cx(
            'animate-fade-up fixed left-1/2 top-[8vh] z-[81] max-h-[84vh] w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-2xl border border-border bg-surface p-6 shadow-pop',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="font-display text-lg font-semibold tracking-tight">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-sm text-text-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button className="rounded-lg p-1.5 text-text-3 hover:bg-bg-subtle hover:text-text" aria-label="Close">
                <X className="size-4" />
              </button>
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-sm text-text-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
