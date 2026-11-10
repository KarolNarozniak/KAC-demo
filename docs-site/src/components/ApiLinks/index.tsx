import React from 'react';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function ApiLinks() {
  const { siteConfig } = useDocusaurusContext();
  const apiOrigin = String(siteConfig.customFields?.apiOrigin ?? 'http://localhost:4000').replace(/\/$/, '');
  return <ul>
    <li><a href={`${apiOrigin}/api/v1/docs`}><Translate id="api.links.swagger">Open Swagger UI</Translate></a></li>
    <li><a href={`${apiOrigin}/api/v1/openapi.json`}><Translate id="api.links.spec">Download the OpenAPI JSON specification</Translate></a></li>
    <li><Link to="/docs/api/openapi-reference"><Translate id="api.links.reference">Browse the generated endpoint reference</Translate></Link></li>
  </ul>;
}
