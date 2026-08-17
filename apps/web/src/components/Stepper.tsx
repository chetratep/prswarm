import { Link, useLocation } from "react-router-dom";

export interface StepDef {
  path: string;
  label: string;
  /** True for steps whose route is scoped to a job (`/preview/:jobId` etc). */
  needsJobId?: boolean;
}

export const STEPS: StepDef[] = [
  { path: "/connect", label: "Connect" },
  { path: "/select", label: "Select" },
  { path: "/define", label: "Define" },
  { path: "/preview", label: "Preview", needsJobId: true },
  { path: "/confirm", label: "Confirm", needsJobId: true },
  { path: "/execute", label: "Execute", needsJobId: true },
  { path: "/results", label: "Results", needsJobId: true },
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
          const isPast = currentIndex >= 0 && index < currentIndex;
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

          return (
            <li key={step.path} className={className}>
              {isDisabled ? (
                <span
                  className="stepper__link stepper__link--disabled"
                  title="Create a job first — start from Define"
                >
                  <span className="stepper__index">{index + 1}</span>
                  <span className="stepper__label">{step.label}</span>
                </span>
              ) : (
                <Link
                  to={target}
                  className="stepper__link"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="stepper__index">{index + 1}</span>
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
