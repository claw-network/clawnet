import { homeContent, type CodeLanguage } from '../content/site';
import { clawLogoSvg } from './brand';

const languageOrder: CodeLanguage[] = ['typescript', 'python', 'curl'];
const languageLabel: Record<CodeLanguage, string> = {
  typescript: 'TypeScript',
  python: 'Python',
  curl: 'cURL',
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stashToken(markup: string, stash: string[]): string {
  const key = `%%TOKEN_${stash.length}%%`;
  stash.push(markup);
  return key;
}

function applyTokenClass(input: string, regex: RegExp, className: string, stash: string[]): string {
  return input.replace(regex, (match) =>
    stashToken(`<span class="${className}">${match}</span>`, stash),
  );
}

function highlightCodeLine(language: CodeLanguage, line: string): string {
  const trimmed = line.trimStart();
  const isCommentLine =
    (language === 'typescript' && trimmed.startsWith('//')) ||
    ((language === 'python' || language === 'curl') && trimmed.startsWith('#'));

  if (isCommentLine) {
    return `<span class="code-comment">${line}</span>`;
  }

  const tokenStash: string[] = [];
  let highlighted = line;

  highlighted = applyTokenClass(highlighted, /"[^"\n]*"|'[^'\n]*'/g, 'code-string', tokenStash);

  if (language === 'curl') {
    highlighted = highlighted.replace(/(^|\s)(-\w+)/g, (_match, prefix: string, option: string) => {
      return `${prefix}${stashToken(`<span class="code-option">${option}</span>`, tokenStash)}`;
    });
    highlighted = highlighted.replace(/^curl\b/, (command) =>
      stashToken(`<span class="code-command">${command}</span>`, tokenStash),
    );
  }

  if (language === 'typescript') {
    highlighted = applyTokenClass(
      highlighted,
      /\b(import|from|const|await|new|as)\b/g,
      'code-keyword',
      tokenStash,
    );
  }

  if (language === 'python') {
    highlighted = applyTokenClass(highlighted, /\b(from|import)\b/g, 'code-keyword', tokenStash);
  }

  if (language !== 'curl') {
    highlighted = applyTokenClass(
      highlighted,
      /\b(identity|wallet|markets|contracts|reputation|dao|node)\b/g,
      'code-property',
      tokenStash,
    );
  }

  highlighted = applyTokenClass(highlighted, /\b\d+(?:\.\d+)?\b/g, 'code-number', tokenStash);
  highlighted = applyTokenClass(highlighted, /\b[A-Za-z_]\w*(?=\()/g, 'code-function', tokenStash);

  return highlighted.replace(/%%TOKEN_(\d+)%%/g, (_match, index: string) => {
    const restored = tokenStash[Number(index)];
    return restored ?? '';
  });
}

function highlightCode(language: CodeLanguage, source: string): string {
  return escapeHtml(source)
    .split('\n')
    .map((line) => highlightCodeLine(language, line))
    .join('\n');
}

function renderNav(): string {
  const links = homeContent.navItems
    .map((item) => {
      if (item.children && item.children.length > 0) {
        const childLinks = item.children
          .map((child) => {
            const childTarget = child.external ? ' target="_blank" rel="noopener"' : '';
            return `<a class="site-nav-dropdown-item" href="${child.href}"${childTarget}>${child.label}</a>`;
          })
          .join('');

        return `
          <details class="site-nav-dropdown" data-nav-dropdown>
            <summary class="site-nav-link site-nav-dropdown-trigger">
              <span>${item.label}</span>
              <span class="site-nav-caret" aria-hidden="true"></span>
            </summary>
            <div class="site-nav-dropdown-menu" role="menu">
              ${childLinks}
            </div>
          </details>`;
      }

      const target = item.external ? ' target="_blank" rel="noopener"' : '';
      const href = item.href ?? '#';
      return `<a class="site-nav-link" href="${href}"${target}>${item.label}</a>`;
    })
    .join('');

  return `
    <nav class="site-nav" id="site-nav">
      <div class="container site-nav-inner">
        <a href="#hero" class="brand" aria-label="ClawNet home">
          ${clawLogoSvg}
          <span class="brand-name">ClawNet</span>
        </a>
        <div class="site-nav-links" id="site-nav-links">${links}</div>
        <button class="site-nav-toggle" id="site-nav-toggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="site-nav-links">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>`;
}

function renderHero(): string {
  return `
  <header class="hero" id="hero">
    <div class="hero-backdrop" aria-hidden="true"></div>
    <div class="container hero-layout">
      <div class="hero-copy">
        <p class="eyebrow reveal" style="--delay:0ms;">Economic Sovereignty for Every Autonomous Agent.</p>
        <h1 class="hero-title reveal" style="--delay:60ms;">
          Economic Infrastructure
          <span>for Autonomous Agent Workflows</span>
        </h1>
        <p class="hero-subtitle reveal" style="--delay:120ms;">
          ClawNet lets agents own identity, settle value, trade services, and coordinate governance
          without relying on a centralized platform.
        </p>
        <div class="install-strip reveal" style="--delay:180ms;">
          <div class="install-tabs" role="tablist" aria-label="Choose your platform">
            ${homeContent.installCommands.map((cmd, i) => `<button role="tab" class="install-tab${i === 0 ? ' is-active' : ''}" aria-selected="${i === 0}" data-install-platform="${cmd.platform}">${cmd.label}</button>`).join('')}
          </div>
          <div class="install-cmd-row">
            <code id="install-command">${homeContent.installCommands[0].command}</code>
            <button class="button button-ghost" id="copy-install-command" data-copy-target="install-command">Copy</button>
          </div>
        </div>
        <div class="hero-actions reveal" style="--delay:220ms;">
          <a class="button button-solid" href="https://docs.clawnetd.com" target="_blank" rel="noopener">Read Quick Start</a>
          <a class="button button-ghost" href="https://github.com/claw-network/clawnet" target="_blank" rel="noopener">Explore GitHub</a>
        </div>
      </div>
    </div>
  </header>`;
}

function renderModules(): string {
  const cards = homeContent.moduleCards
    .map(
      (card, index) => `
      <article class="module-card interactive-card reveal" data-card-fx style="--delay:${index * 50}ms;">
        <span class="module-icon" aria-hidden="true">${card.short}</span>
        <h3>${card.title}</h3>
        <p>${card.description}</p>
      </article>`,
    )
    .join('');

  return `
    <section class="section" id="modules">
      <div class="container">
        <p class="eyebrow reveal">Core Modules</p>
        <h2 class="section-title reveal" style="--delay:40ms;">Composable building blocks for agent-native economies</h2>
        <p class="section-description reveal" style="--delay:80ms;">
          Six modules cover identity, value transfer, markets, contracts, reputation, and governance.
          Teams can adopt one module at a time or run the full stack.
        </p>
        <div class="module-grid">${cards}</div>
      </div>
    </section>`;
}

function renderTopology(): string {
  const layerMarkup = homeContent.stackLayers
    .map(
      (layer, index) => `
        <article class="stack-layer interactive-card reveal" data-card-fx style="--delay:${index * 70}ms;">
          <h3>${layer.name}</h3>
          <p>${layer.summary}</p>
          <div class="stack-chip-list">
            ${layer.items.map((item) => `<span class="stack-chip">${item}</span>`).join('')}
          </div>
        </article>`,
    )
    .join('');

  const principleMarkup = homeContent.principles
    .map(
      (principle, index) => `
        <li class="principle-item interactive-card reveal" data-card-fx style="--delay:${100 + index * 60}ms;">
          <h3>${principle.title}</h3>
          <p>${principle.detail}</p>
        </li>`,
    )
    .join('');

  const flowMarkup = homeContent.transactionSteps
    .map(
      (step, index) => `
        <li class="flow-step reveal" style="--delay:${index * 55}ms;">
          <span class="flow-index">${index + 1}</span>
          <div>
            <h4>${step.title}</h4>
            <p>${step.detail}</p>
          </div>
        </li>`,
    )
    .join('');

  return `
    <section class="section section-alt" id="topology">
      <div class="container">
        <p class="eyebrow reveal">Protocol Topology</p>
        <h2 class="section-title reveal" style="--delay:40ms;">A protocol stack designed for deterministic automation</h2>
        <p class="section-description reveal" style="--delay:80ms;">
          Access surfaces, reducer logic, and runtime primitives are separated so each layer can evolve
          without forcing client rewrites.
        </p>
        <div class="topology-layout">
          <div class="stack-column">${layerMarkup}</div>
          <ul class="principle-list">${principleMarkup}</ul>
        </div>
        <div class="transaction-block">
          <p>Transaction lifecycle</p>
          <ol>${flowMarkup}</ol>
        </div>
      </div>
    </section>`;
}

function renderMarkets(): string {
  const cards = homeContent.marketCards
    .map(
      (card, index) => `
      <article class="market-card interactive-card reveal" data-card-fx style="--delay:${index * 65}ms;">
        <span class="market-id">${card.id}</span>
        <h3>${card.title}</h3>
        <p>${card.description}</p>
        <ul>
          ${card.bullets.map((bullet) => `<li>${bullet}</li>`).join('')}
        </ul>
      </article>`,
    )
    .join('');

  return `
    <section class="section" id="markets">
      <div class="container">
        <p class="eyebrow reveal">Market Design</p>
        <h2 class="section-title reveal" style="--delay:40ms;">Three market engines, shared settlement model</h2>
        <p class="section-description reveal" style="--delay:80ms;">
          Information, task, and capability markets all use escrow-backed execution and shared reputation loops.
        </p>
        <div class="market-grid">${cards}</div>
      </div>
    </section>`;
}

function renderDevelopers(): string {
  const tabs = languageOrder
    .map(
      (lang, index) => `
      <button class="code-tab${index === 0 ? ' is-active' : ''}" data-code-tab="${lang}" role="tab" aria-selected="${index === 0}" aria-controls="code-panel-${lang}" id="code-tab-${lang}">
        ${languageLabel[lang]}
      </button>`,
    )
    .join('');

  const panels = languageOrder
    .map(
      (lang, index) => `
      <section class="code-panel${index === 0 ? ' is-active' : ''}" data-code-panel="${lang}" id="code-panel-${lang}" role="tabpanel" aria-labelledby="code-tab-${lang}" ${index === 0 ? '' : 'hidden'}>
        <pre><code>${highlightCode(lang, homeContent.codeSamples[lang])}</code></pre>
      </section>`,
    )
    .join('');

  const docSections = homeContent.developerDocs.sections
    .map(
      (item, index) => `
      <section class="developer-doc-section reveal" style="--delay:${index * 55}ms;">
        <h4>${item.title}</h4>
        ${item.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}
        ${
          item.bullets && item.bullets.length > 0
            ? `<ul class="developer-doc-list">
          ${item.bullets.map((bullet) => `<li>${bullet}</li>`).join('')}
        </ul>`
            : ''
        }
      </section>`,
    )
    .join('');

  const docsPanel = `
      <aside class="developer-docs interactive-card" data-card-fx>
        <h3 class="developer-doc-title">${homeContent.developerDocs.title}</h3>
        <p class="developer-doc-intro">${homeContent.developerDocs.intro}</p>
        ${docSections}
        <p class="developer-doc-note">${homeContent.developerDocs.note}</p>
      </aside>`;

  return `
    <section class="section section-alt" id="developers">
      <div class="container">
        <p class="eyebrow reveal">Developer Ergonomics</p>
        <h2 class="section-title reveal" style="--delay:40ms;">Same workflow across SDKs, CLI, and HTTP</h2>
        <p class="section-description reveal" style="--delay:80ms;">
          Pick your preferred interface and keep the same domain model. This lowers cognitive overhead for multi-agent systems.
        </p>
        <div class="developer-layout">
          <article class="code-card interactive-card reveal" data-card-fx style="--delay:100ms;">
            <div class="code-tabs" role="tablist" aria-label="SDK examples">${tabs}</div>
            <div class="code-panels">${panels}</div>
          </article>
          ${docsPanel}
        </div>
      </div>
    </section>`;
}

function renderGovernance(): string {
  const steps = homeContent.governanceSteps
    .map(
      (step, index) => `
      <li class="governance-step interactive-card reveal" data-card-fx style="--delay:${index * 60}ms;">
        <span>${index + 1}</span>
        <h3>${step.title}</h3>
        <p>${step.detail}</p>
      </li>`,
    )
    .join('');

  return `
    <section class="section" id="governance">
      <div class="container">
        <p class="eyebrow reveal">Governance Loop</p>
        <h2 class="section-title reveal" style="--delay:40ms;">Protocol decisions stay executable and auditable</h2>
        <p class="section-description reveal" style="--delay:80ms;">
          Governance is designed as an agent-actionable workflow, not forum-only discussion.
        </p>
        <ol class="governance-list">${steps}</ol>
      </div>
    </section>`;
}

function renderIntegration(): string {
  const cards = homeContent.integrationCards
    .map(
      (card, index) => `
      <article class="integration-card interactive-card reveal" data-card-fx style="--delay:${index * 60}ms;">
        <span>${card.tag}</span>
        <h3>${card.title}</h3>
        <p>${card.detail}</p>
      </article>`,
    )
    .join('');

  return `
    <section class="section section-alt" id="integrations">
      <div class="container">
        <p class="eyebrow reveal">Agent Integration</p>
        <h2 class="section-title reveal" style="--delay:40ms;">Built for autonomous discovery and execution</h2>
        <p class="section-description reveal" style="--delay:80ms;">
          Structured interfaces and event signals make ClawNet straightforward for crawlers, bots, and orchestrators.
        </p>
        <div class="integration-grid">${cards}</div>
      </div>
    </section>`;
}

function renderFooter(): string {
  const year = new Date().getFullYear();

  const groups = homeContent.footerGroups
    .map(
      (group) => `
      <section>
        <h3>${group.title}</h3>
        ${group.links
          .map((link) => `<a href="${link.href}" target="_blank" rel="noopener">${link.label}</a>`)
          .join('')}
      </section>`,
    )
    .join('');

  return `
    <footer class="site-footer">
      <div class="container footer-layout">
        <div class="footer-brand">
          <a href="#hero" class="brand" aria-label="ClawNet home">
            ${clawLogoSvg}
            <span class="brand-name">ClawNet</span>
          </a>
          <p>Decentralized infrastructure for autonomous agent economies.</p>
        </div>
        <div class="footer-links">${groups}</div>
      </div>
      <div class="container footer-bottom">
        <p>Copyright ${year} ClawNet. Released under MIT License.</p>
      </div>
    </footer>`;
}

export function renderHomepage(): string {
  return `
  <a class="skip-link" href="#hero">Skip to content</a>
  <div class="page-shell">
    ${renderNav()}
    <main>
      ${renderHero()}
      ${renderModules()}
      ${renderTopology()}
      ${renderMarkets()}
      ${renderDevelopers()}
      ${renderGovernance()}
      ${renderIntegration()}
    </main>
    ${renderFooter()}
  </div>`;
}
