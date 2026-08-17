import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

interface SelectionContextValue {
  selectedRepos: Set<string>;
  // Dispatch<SetStateAction<...>>, not a plain value setter, so callers can
  // still use the updater-function form (setSelectedRepos(prev => ...)) —
  // SelectPage relies on that to toggle individual repos off the latest
  // state rather than a possibly-stale closed-over value.
  setSelectedRepos: Dispatch<SetStateAction<Set<string>>>;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Lifts repo selection out of SelectPage so it survives navigating on to
 * /define (and beyond) — it's the set of "owner/repo" full names the whole
 * rest of the workflow (changeset -> job -> preview -> confirm) targets.
 * Lives above <Routes> in App.tsx, inside the authenticated branch only.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());

  const value = useMemo(() => ({ selectedRepos, setSelectedRepos }), [selectedRepos]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return ctx;
}
