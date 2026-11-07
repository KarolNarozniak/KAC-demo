import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import styles from './index.module.css';

export default function Home() {
  return <Layout>
    <main className={styles.hero}>
      <div className={styles.eyebrow}><Translate id="home.eyebrow">PRODUCT · ENGINEERING · API</Translate></div>
      <h1><Translate id="home.title.first">Jeden kalendarz.</Translate><br /><span><Translate id="home.title.second">Lepszy plan tygodnia.</Translate></span></h1>
      <p><Translate id="home.description">Dokumentacja KAC Platform: lokalny start, architektura modułów, zasady zmian API oraz interaktywny kontrakt OpenAPI.</Translate></p>
      <div className={styles.actions}>
        <Link className="button button--primary button--lg" to="/docs/intro"><Translate id="home.docs">Poznaj platformę</Translate></Link>
        <Link className="button button--secondary button--lg" href="http://localhost:4000/api/v1/docs"><Translate id="home.swagger">Otwórz Swagger UI</Translate></Link>
      </div>
      <div className={styles.footer}><Translate id="home.footer.api">REST API</Translate> <strong>/api/v1</strong><span>·</span> Node.js 24 <span>·</span> PostgreSQL 16 <span>·</span> Docusaurus</div>
    </main>
  </Layout>;
}

export function Head() {
  return <><title>KAC Platform</title><meta name="description" content="Product, engineering and API documentation" /></>;
}
