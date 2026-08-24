import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'quick-start',
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/workflow',
        'guides/multi-file-and-templates',
        'guides/authentication',
        'guides/multi-user-and-admin',
      ],
    },
    'cli-reference',
    'configuration',
    'architecture',
    'security-and-privacy',
    'contributing',
  ],
};

export default sidebars;
