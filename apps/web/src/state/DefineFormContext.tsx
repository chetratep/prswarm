import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { BranchStrategy, CommitStrategy } from "@prswarm/shared-types";
import type { FileEntryValue } from "../components/FileEntryEditor";

export type Landing = "DIRECT_DEFAULT" | "NEW_BRANCH" | "PR";

export const LANDING_STRATEGIES: Record<
  Landing,
  { commitStrategy: CommitStrategy; branchStrategy: BranchStrategy }
> = {
  DIRECT_DEFAULT: { commitStrategy: "DIRECT_COMMIT", branchStrategy: "DEFAULT" },
  NEW_BRANCH: { commitStrategy: "DIRECT_COMMIT", branchStrategy: "NEW_BRANCH" },
  PR: { commitStrategy: "PULL_REQUEST", branchStrategy: "NEW_BRANCH" },
};

function emptyFile(): FileEntryValue {
  return { filePath: "", mode: "UPSERT", content: "" };
}

interface DefineFormContextValue {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  files: FileEntryValue[];
  setFiles: Dispatch<SetStateAction<FileEntryValue[]>>;
  commitMessage: string;
  setCommitMessage: Dispatch<SetStateAction<string>>;
  landing: Landing | null;
  setLanding: Dispatch<SetStateAction<Landing | null>>;
  prTitle: string;
  setPrTitle: Dispatch<SetStateAction<string>>;
  prBody: string;
  setPrBody: Dispatch<SetStateAction<string>>;
  templateValues: Record<string, Record<string, string>>;
  setTemplateValues: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  /** Wipes the form back to a single empty file — called once a job this
   * form produced actually starts running (see ConfirmPage), not on every
   * Preview round trip, so navigating Define <-> Preview <-> Confirm to
   * tweak content never loses what was typed. */
  resetDefineForm: () => void;
}

const DefineFormContext = createContext<DefineFormContextValue | null>(null);

/**
 * Lifts the Define page's form fields out of DefinePage so they survive
 * navigating to /preview/:jobId and back — mirrors SelectionContext (see
 * state/SelectionContext.tsx) for the same reason: React Router unmounts
 * DefinePage when you leave it, and plain useState would lose everything a
 * user typed the moment they click "back" from Preview to fix something.
 */
export function DefineFormProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<FileEntryValue[]>([emptyFile()]);
  const [commitMessage, setCommitMessage] = useState("");
  const [landing, setLanding] = useState<Landing | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [templateValues, setTemplateValues] = useState<Record<string, Record<string, string>>>({});

  function resetDefineForm() {
    setName("");
    setFiles([emptyFile()]);
    setCommitMessage("");
    setLanding(null);
    setPrTitle("");
    setPrBody("");
    setTemplateValues({});
  }

  const value = useMemo(
    () => ({
      name,
      setName,
      files,
      setFiles,
      commitMessage,
      setCommitMessage,
      landing,
      setLanding,
      prTitle,
      setPrTitle,
      prBody,
      setPrBody,
      templateValues,
      setTemplateValues,
      resetDefineForm,
    }),
    [name, files, commitMessage, landing, prTitle, prBody, templateValues],
  );

  return <DefineFormContext.Provider value={value}>{children}</DefineFormContext.Provider>;
}

export function useDefineForm(): DefineFormContextValue {
  const ctx = useContext(DefineFormContext);
  if (!ctx) {
    throw new Error("useDefineForm must be used within a DefineFormProvider");
  }
  return ctx;
}
