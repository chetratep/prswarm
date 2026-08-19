import { Fragment, type ComponentType, type SVGProps } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  IconEye,
  IconFlag,
  IconList,
  IconPencil,
  IconPlay,
  IconPlug,
  IconShieldCheck,
} from "./icons";
import { useSelection } from "../state/SelectionContext";
import { cn } from "@/lib/utils";

export interface StepDef {
  path: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /** True for steps whose route is scoped to a job (`/preview/:jobId` etc). */
  needsJobId?: boolean;
  /** Select and Define aren't about any particular job — they read/write
   * SelectionContext, in-memory state that lives above the router (see
   * App.tsx) and is empty on any fresh session, including one that landed
   * on a job-scoped page via History rather than through the wizard. A step
   * marked this way only ever renders "past" (checkmarked, implying "you
   * already did this, click to revisit") when there's real evidence it
   * happened THIS session — otherwise the checkmark is a lie: clicking it
   * doesn't revisit anything, it silently bounces to Connect/Select instead
   * (SelectPage redirects without a connection, DefinePage redirects
   * without a selection), which is exactly the "steps look done but click
   * somewhere weird" bug this exists to fix. */
  sessionDependent?: boolean;
}

export const STEPS: StepDef[] = [
  { path: "/connect", label: "Connect", icon: IconPlug },
  { path: "/select", label: "Select", icon: IconList, sessionDependent: true },
  { path: "/define", label: "Define", icon: IconPencil, sessionDependent: true },
  { path: "/preview", label: "Preview", icon: IconEye, needsJobId: true },
  { path: "/confirm", label: "Confirm", icon: IconShieldCheck, needsJobId: true },
  { path: "/execute", label: "Execute", icon: IconPlay, needsJobId: true },
  { path: "/results", label: "Results", icon: IconFlag, needsJobId: true },
];

const JOB_SCOPED_PATH = /^\/(preview|confirm|execute|results)\/([^/]+)/;

/**
 * Persistent horizontal stepper for the 7-step workflow.
 *
 * Preview/Confirm/Execute/Results are scoped to a job (`/preview/:jobId`
 * etc), so there's no fixed URL for the stepper to link to until a job
 * exists — linking to bare "/preview" would just fall through to the
 * catch-all route and bounce back to /connect. Rather than adding a
 * separate "current job" context, the stepper recovers it from the URL: if
 * you're anywhere on one of those four routes, its jobId carries forward
 * to the other three (so switching between them keeps the same job in
 * view); otherwise those steps render disabled instead of linking
 * somewhere that can't resolve.
 */
export function Stepper() {
  const location = useLocation();
  const { selectedRepos } = useSelection();
  const hasActiveSelection = selectedRepos.size > 0;
  const jobMatch = location.pathname.match(JOB_SCOPED_PATH);
  const currentJobId = jobMatch ? jobMatch[2] : null;

  const currentIndex = STEPS.findIndex((step) =>
    step.needsJobId
      ? location.pathname.startsWith(step.path + "/")
      : step.path === location.pathname,
  );

  return (
    <nav className="w-full pb-3" aria-label="Workflow steps">
      <ol className="flex w-full items-center">
        {STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isPast =
            currentIndex >= 0 &&
            index < currentIndex &&
            (!step.sessionDependent || hasActiveSelection);
          const isDisabled = Boolean(step.needsJobId) && !currentJobId;
          const target = step.needsJobId ? `${step.path}/${currentJobId}` : step.path;
          // Purely decorative progress-line fill — how far you've navigated,
          // not whether a session-dependent step (Select/Define) actually
          // has real state behind it. That distinction only matters for the
          // node's own click affordance (isPast/isDisabled below), not for
          // this connecting line.
          const lineBeforeFilled = currentIndex >= 0 && index <= currentIndex;

          const Icon = step.icon;

          const circleClassName = cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
            isCurrent || isPast ? "bg-link text-white" : "bg-muted text-muted-foreground",
          );

          const labelClassName = cn(
            "flex h-[15px] items-center gap-1.5 whitespace-nowrap text-[0.8125rem] leading-[15px] transition-colors",
            isCurrent ? "font-semibold text-foreground" : "text-muted-foreground",
            !isCurrent && isPast && "text-foreground/80",
            !isCurrent && !isDisabled && "group-hover:text-foreground",
            isDisabled && "text-muted-foreground/50",
          );

          const node = (
            <div className="flex flex-col items-center gap-2">
              <span className={circleClassName}>{index + 1}</span>
              <span className={labelClassName}>
                <Icon size={15} className="block shrink-0 self-center" />
                {step.label}
              </span>
            </div>
          );

          return (
            <Fragment key={step.path}>
              {index > 0 && (
                <li
                  aria-hidden="true"
                  className={cn(
                    "mx-1.5 h-0.5 flex-1 rounded-full transition-colors",
                    lineBeforeFilled ? "bg-link" : "bg-border",
                  )}
                />
              )}
              <li className="group flex shrink-0">
                {isDisabled ? (
                  <span
                    className="cursor-not-allowed"
                    title="Create a job first — start from Define"
                  >
                    {node}
                  </span>
                ) : (
                  <Link to={target} aria-current={isCurrent ? "step" : undefined}>
                    {node}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
