import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <img src="/prswarm/img/favicon.svg" alt="" className={styles.heroLogo} />
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/intro">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            to="https://github.com/chetratep/prswarm"
            style={{marginLeft: '1rem'}}>
            View on GitHub
          </Link>
        </div>
        <pre className={styles.heroCode}>
          <code>curl -fsSL https://raw.githubusercontent.com/chetratep/prswarm/main/install.sh | bash</code>
        </pre>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="PRSwarm — bulk GitHub file changes, reviewed before they write"
      description="Push one file change across a chosen set of GitHub orgs/repos, with a real per-repo diff reviewed before anything writes. Self-hosted, open source, MIT licensed.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
