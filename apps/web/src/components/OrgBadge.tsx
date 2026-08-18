// Small colored monogram for an org/owner login — used wherever an org is
// referenced but no real GitHub avatar was fetched for it (Preview/Confirm's
// org-group headings, the Select page's selection summary). Color is
// deterministic from the login itself, so the same org always gets the same
// badge across the whole app — a lightweight, functional identity marker
// for "which org am I looking at", not decoration.
function hashLogin(login: string): number {
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = (hash << 5) - hash + login.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function OrgBadge({ login, size = 20 }: { login: string; size?: number }) {
  const hue = hashLogin(login) % 360;
  const initials = login.slice(0, 2).toUpperCase();

  return (
    <span
      className="org-badge"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue}, 68%, 56%), hsl(${(hue + 35) % 360}, 68%, 44%))`,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
