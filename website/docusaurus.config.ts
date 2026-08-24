import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'PRSwarm',
  tagline: 'Push one file change across a swarm of GitHub repos, with a real diff reviewed before anything writes.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://chetratep.github.io',
  baseUrl: '/prswarm/',

  organizationName: 'chetratep',
  projectName: 'prswarm',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/chetratep/prswarm/tree/main/website/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'PRSwarm',
      logo: {
        alt: 'PRSwarm logo',
        src: 'img/favicon.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/chetratep/prswarm/releases',
          label: 'Releases',
          position: 'right',
        },
        {
          href: 'https://github.com/chetratep/prswarm',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Introduction', to: '/intro'},
            {label: 'Installation', to: '/installation'},
            {label: 'Quick Start', to: '/quick-start'},
            {label: 'CLI Reference', to: '/cli-reference'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: 'https://github.com/chetratep/prswarm'},
            {label: 'Releases', href: 'https://github.com/chetratep/prswarm/releases'},
            {label: 'License (MIT)', href: 'https://github.com/chetratep/prswarm/blob/main/LICENSE'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} PRSwarm. MIT licensed.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'powershell', 'yaml', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
