import type { SVGProps } from "react";

// Hand-authored, dependency-free icon set (no icon-library package — see
// CLAUDE.md's "be conservative about adding dependencies" note). Every icon
// shares one visual language: 24x24 grid, currentColor stroke, rounded caps
// — so mixing them anywhere in the app reads as one system, not a grab bag.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function iconBase(children: React.ReactNode) {
  return function Icon({ size = 18, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };
}

/** The app's mark: a branch fanning into two — "one change, many repos". */
export const LogoMark = iconBase(
  <>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </>
);

export const IconPlug = iconBase(
  <>
    <path d="M9 2v4M15 2v4M6 8h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </>
);

export const IconList = iconBase(
  <>
    <line x1="8.5" y1="6" x2="21" y2="6" />
    <line x1="8.5" y1="12" x2="21" y2="12" />
    <line x1="8.5" y1="18" x2="21" y2="18" />
    <line x1="3.5" y1="6" x2="3.51" y2="6" />
    <line x1="3.5" y1="12" x2="3.51" y2="12" />
    <line x1="3.5" y1="18" x2="3.51" y2="18" />
  </>
);

export const IconPencil = iconBase(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>
);

export const IconEye = iconBase(
  <>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

export const IconShieldCheck = iconBase(
  <>
    <path d="M12 2 4 5v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V5Z" />
    <polyline points="9 12 11 14 15 10" />
  </>
);

export const IconPlay = iconBase(<polygon points="6 3 20 12 6 21 6 3" />);

export const IconFlag = iconBase(
  <>
    <line x1="5" y1="22" x2="5" y2="3" />
    <path d="M5 4h13l-2.5 4L18 12H5" />
  </>
);

export const IconHistory = iconBase(
  <>
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M3 3v5h5" />
    <polyline points="12 8 12 12 15.5 14" />
  </>
);

export const IconInbox = iconBase(
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </>
);

export const IconChevronDown = iconBase(<polyline points="6 9 12 15 18 9" />);
export const IconChevronUp = iconBase(<polyline points="18 15 12 9 6 15" />);

export const IconTrash = iconBase(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>
);

export const IconUser = iconBase(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

export const IconCheckCircle = iconBase(
  <>
    <circle cx="12" cy="12" r="9" />
    <polyline points="8 12.5 11 15.5 16 9.5" />
  </>
);

export const IconXCircle = iconBase(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </>
);

export const IconMinusCircle = iconBase(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </>
);

export const IconPlusCircle = iconBase(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </>
);

export const IconAlertTriangle = iconBase(
  <>
    <path d="M12 3 21.5 20H2.5Z" />
    <line x1="12" y1="9.5" x2="12" y2="14" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>
);

export const IconClock = iconBase(
  <>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </>
);

export const IconKey = iconBase(
  <>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.5 12.5 20 3M20 3h-4M20 3v4" />
  </>
);

export const IconSearch = iconBase(
  <>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>
);
