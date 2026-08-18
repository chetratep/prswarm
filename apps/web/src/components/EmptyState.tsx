import type { ReactNode } from "react";
import { IconInbox } from "./icons";

/** A bare "no results" sentence reads as an afterthought. This gives every
 * empty list in the app (no runs yet, no repos in this job, no repos match)
 * the same small icon + message treatment, optionally with a next step. */
export function EmptyState({
  message,
  action,
  icon,
}: {
  message: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">{icon ?? <IconInbox size={22} />}</span>
      <p className="empty-state__message">{message}</p>
      {action}
    </div>
  );
}
