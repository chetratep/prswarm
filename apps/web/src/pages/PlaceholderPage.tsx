export interface PlaceholderPageProps {
  title: string;
  description: string;
}

/**
 * Reusable stand-in for the not-yet-built steps (3-7). Renders honestly as
 * "not built yet" rather than faking data — the point of the stepper is to
 * show the shape of the whole workflow, not to pretend later steps work.
 */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <h2>{title}</h2>
      <p className="placeholder-page__badge">Not built yet</p>
      <p className="placeholder-page__description">{description}</p>
    </div>
  );
}
