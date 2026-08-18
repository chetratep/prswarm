import type { ComponentType, SVGProps } from "react";
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
    <nav className="stepper" aria-label="Workflow steps">
      <ol>
        {STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isPast =
            currentIndex >= 0 &&
            index < currentIndex &&
            (!step.sessionDependent || hasActiveSelection);
          const isDisabled = Boolean(step.needsJobId) && !currentJobId;
          const className = [
            "stepper__item",
            isCurrent ? "stepper__item--current" : "",
            isPast ? "stepper__item--past" : "",
            isDisabled ? "stepper__item--disabled" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const target = step.needsJobId ? `${step.path}/${currentJobId}` : step.path;

          const Icon = step.icon;

          return (
            <li key={step.path} className={className}>
              {isDisabled ? (
                <span
                  className="stepper__link stepper__link--disabled"
                  title="Create a job first — start from Define"
                >
                  <span className="stepper__index">{index + 1}</span>
                  <Icon size={15} />
                  <span className="stepper__label">{step.label}</span>
                </span>
              ) : (
                <Link
                  to={target}
                  className="stepper__link"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="stepper__index">{index + 1}</span>
                  <Icon size={15} />
                  <span className="stepper__label">{step.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
