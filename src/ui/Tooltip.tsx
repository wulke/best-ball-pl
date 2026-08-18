import type { ReactNode } from 'react';

/**
 * Styled hover/focus tooltip for icon controls — replaces native `title`
 * (slow to appear, OS-styled, easy to miss). CSS-only via a named Tailwind
 * group: no state, no portal; shows on hover and keyboard focus, never prints.
 */
export function Tooltip({
  text,
  children,
  side = 'bottom',
  wide = false,
}: {
  text: ReactNode;
  children: ReactNode;
  side?: 'bottom' | 'top';
  wide?: boolean;
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md border border-strong bg-surface-raised px-2 py-1 text-left text-xs font-medium normal-case tracking-normal text-primary opacity-0 shadow-lg transition-opacity delay-75 duration-100 print:hidden group-focus-within/tt:opacity-100 group-hover/tt:opacity-100 ${
          side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
        } ${wide ? 'w-48 whitespace-normal' : 'whitespace-nowrap'}`}
      >
        {text}
      </span>
    </span>
  );
}
