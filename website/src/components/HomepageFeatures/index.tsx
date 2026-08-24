import type {ReactNode, SVGProps} from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

// Same stroke-based icon language as the app itself (apps/web/src/components/icons.tsx):
// 24x24 grid, currentColor stroke, rounded caps — kept dependency-free here too.
function icon(children: ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        width={28}
        height={28}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}>
        {children}
      </svg>
    );
  };
}

const IconDiff = icon(
  <>
    <path d="M7 3v18M17 3v18" />
    <path d="M7 8h10M7 16h10" />
  </>,
);

const IconBranch = icon(
  <>
    <circle cx="6" cy="4" r="2" />
    <circle cx="6" cy="20" r="2" />
    <circle cx="18" cy="12" r="2" />
    <path d="M6 6v12M8 12h4a4 4 0 0 0 4-4V6" />
  </>,
);

const IconPlatforms = icon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);

const IconLock = icon(
  <>
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </>,
);

const IconTemplate = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 4v5" />
  </>,
);

const IconLive = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M5 12a7 7 0 0 1 7-7M19 12a7 7 0 0 1-7 7" />
  </>,
);

type FeatureItem = {
  title: string;
  Icon: React.ComponentType<SVGProps<SVGSVGElement>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'A real diff, every repo',
    Icon: IconDiff,
    description: (
      <>
        Preview computes an actual per-repo, per-file diff before anything writes — new file, modified,
        unchanged, or a clean error. Nothing is inferred; every row is what will really land.
      </>
    ),
  },
  {
    title: 'Three ways to land it',
    Icon: IconBranch,
    description: (
      <>
        Direct push to the default branch, a new branch, or a pull request — all first-class, none
        pre-selected. Direct-to-default pushes get an unconditional typed confirmation gate.
      </>
    ),
  },
  {
    title: 'One binary, every platform',
    Icon: IconPlatforms,
    description: (
      <>
        Download and run — Linux, macOS, or Windows, x64 or arm64. No config file, no runtime to
        install, no companion folder. A <code>.env</code> next to it is only for customizing defaults.
      </>
    ),
  },
  {
    title: 'Encrypted, local-only credentials',
    Icon: IconLock,
    description: (
      <>
        Your PAT or GitHub App private key is AES-256-GCM encrypted at rest and never leaves your
        machine — no telemetry, no hosted service, nothing to trust but your own instance.
      </>
    ),
  },
  {
    title: 'Template variables, per repo',
    Icon: IconTemplate,
    description: (
      <>
        Write one file with <code>{'{{placeholders}}'}</code>, fill in a different value for every
        targeted repo, and preview shows exactly what each one will actually receive.
      </>
    ),
  },
  {
    title: 'Live progress, not a spinner',
    Icon: IconLive,
    description: (
      <>
        Execution runs concurrently in the background and streams real per-repo status over
        server-sent events as each one finishes — no polling, no guessing.
      </>
    ),
  },
];

function Feature({title, Icon, description}: FeatureItem) {
  return (
    <div className={styles.featureCard}>
      <div className={styles.featureIcon}>
        <Icon />
      </div>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p className={styles.featureDescription}>{description}</p>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          {FeatureList.map((props) => (
            <Feature key={props.title} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
