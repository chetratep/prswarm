import type { ComponentType, SVGProps } from "react";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** The `.chip--*` + icon + label pattern used for every status badge in the
 * app (diff status, job status, repo-run status) — one place so the
 * icon/label pairing can't drift between the places that render it. */
export function StatusChip({
  className,
  icon: Icon,
  label,
}: {
  className: string;
  icon: Icon;
  label: string;
}) {
  return (
    <span className={className}>
      <Icon size={13} />
      {label}
    </span>
  );
}
