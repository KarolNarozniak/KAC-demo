import type { Config } from '@docusaurus/types';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const apiOpenApiUrl = process.env.API_OPENAPI_URL ?? `${apiOrigin}/api/v1/openapi.json`;

const config: Config = {
  title: 'KAC Platform',
  tagline: 'Dokumentacja produktu, architektury i API',
  url: process.env.DOCUSAURUS_URL ?? 'http://localhost:3000',
  baseUrl: process.env.DOCUSAURUS_BASE_URL ?? '/',
  favicon: 'img/favicon.svg',
  onBrokenLinks: 'throw',
  i18n: {
    defaultLocale: 'pl',
    locales: ['pl', 'en'],
    localeConfigs: {
      pl: { label: 'Polski', htmlLang: 'pl-PL' },
      en: { label: 'English', htmlLang: 'en-US' },
    },
  },
  customFields: { apiOrigin },
  markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: 'throw' } },
  presets: [
    ['classic', {
      docs: { sidebarPath: './sidebars.ts', docItemComponent: '@theme/ApiItem' },
      blog: false,
      theme: { customCss: './src/css/custom.css' },
    }],
  ],
  plugins: [
    './plugins/webpack-openapi-compat',
    ['docusaurus-plugin-openapi-docs', {
      id: 'openapi',
      docsPluginId: 'classic',
      config: {
        platformPl: {
          specPath: '../apps/api/openapi/openapi.json',
          outputDir: 'docs/api/reference',
          downloadUrl: apiOpenApiUrl,
          showSchemas: true,
          sidebarOptions: { groupPathsBy: 'tag', categoryLinkSource: 'tag' },
        },
        platformEn: {
          specPath: '../apps/api/openapi/openapi.json',
          outputDir: 'i18n/en/docusaurus-plugin-content-docs/current/api/reference',
          downloadUrl: apiOpenApiUrl,
          showSchemas: true,
          sidebarOptions: { groupPathsBy: 'tag', categoryLinkSource: 'tag' },
        },
      },
    }],
  ],
  themes: ['docusaurus-theme-openapi-docs', '@docusaurus/theme-mermaid'],
  themeConfig: {
    image: 'img/social-card.svg',
    navbar: {
      title: 'KAC Platform',
      logo: { alt: 'KAC Platform', src: 'img/logo.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Dokumentacja' },
        { href: `${apiOrigin}/api/v1/docs`, label: 'Swagger UI', position: 'right' },
        { type: 'localeDropdown', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        { title: 'Platforma', items: [{ label: 'API v1', href: `${apiOrigin}/api/v1/docs` }, { label: 'OpenAPI JSON', href: apiOpenApiUrl }] },
        { title: 'Rozwój', items: [{ label: 'Standard zmian API', to: '/docs/api-standard' }, { label: 'Lokalny quickstart', to: '/docs/quickstart' }] },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} KAC Platform.`,
    },
    prism: { additionalLanguages: ['bash', 'powershell', 'json', 'yaml'] },
    mermaid: { theme: { light: 'neutral', dark: 'dark' } },
  },
};

export default config;
