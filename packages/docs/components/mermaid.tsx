'use client';

import { useEffect, useId, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Module-level singletons — shared across all <Mermaid> instances on the page.
// This prevents race conditions where multiple components call initialize()
// concurrently (which corrupts global Mermaid state and can make flowchart LR
// render as TB on page refresh).
// ---------------------------------------------------------------------------
let mermaidMod: typeof import('mermaid')['default'] | null = null;
let lastIsDark: boolean | null = null;
let renderQueue: Promise<void> = Promise.resolve();

const DARK_VARS = {
  primaryColor: '#dce4ee',
  primaryTextColor: '#1e293b',
  primaryBorderColor: '#94a3b8',
  secondaryColor: '#e2e8f0',
  secondaryTextColor: '#334155',
  secondaryBorderColor: '#94a3b8',
  tertiaryColor: '#dce4ee',
  tertiaryTextColor: '#1e293b',
  lineColor: '#94a3b8',
  textColor: '#1e293b',
  mainBkg: '#dce4ee',
  nodeBorder: '#94a3b8',
  nodeTextColor: '#1e293b',
  clusterBkg: '#e2e8f0',
  clusterBorder: '#94a3b8',
  titleColor: '#1e293b',
  edgeLabelBackground: '#f1f5f9',
  defaultLinkColor: '#94a3b8',
  actorBkg: '#dce4ee',
  actorBorder: '#94a3b8',
  actorTextColor: '#1e293b',
  actorLineColor: '#94a3b8',
  signalColor: '#94a3b8',
  signalTextColor: '#1e293b',
  labelBoxBkgColor: '#dce4ee',
  labelBoxBorderColor: '#94a3b8',
  labelTextColor: '#1e293b',
  loopTextColor: '#475569',
  noteBkgColor: '#e8ecf2',
  noteBorderColor: '#94a3b8',
  noteTextColor: '#475569',
  activationBkgColor: '#e2e8f0',
  activationBorderColor: '#94a3b8',
  sequenceNumberColor: '#1e293b',
  labelColor: '#1e293b',
  altBackground: '#e2e8f0',
  compositeBackground: '#e2e8f0',
  compositeBorder: '#94a3b8',
  compositeTitleBackground: '#dce4ee',
  innerEndBackground: '#94a3b8',
  transitionColor: '#94a3b8',
  transitionLabelColor: '#475569',
  stateLabelColor: '#1e293b',
  stateBkg: '#dce4ee',
  specialStateColor: '#64748b',
  edgeLabelColor: '#475569',
};

const LIGHT_VARS = {
  primaryColor: '#f1f5f9',
  primaryTextColor: '#1e293b',
  primaryBorderColor: '#cbd5e0',
  secondaryColor: '#e2e8f0',
  secondaryTextColor: '#334155',
  secondaryBorderColor: '#cbd5e0',
  tertiaryColor: '#f1f5f9',
  tertiaryTextColor: '#1e293b',
  lineColor: '#94a3b8',
  textColor: '#1e293b',
  mainBkg: '#f1f5f9',
  nodeBorder: '#cbd5e0',
  nodeTextColor: '#1e293b',
  clusterBkg: '#e2e8f0',
  clusterBorder: '#cbd5e0',
  titleColor: '#1e293b',
  edgeLabelBackground: '#ffffff',
  defaultLinkColor: '#94a3b8',
  actorBkg: '#f1f5f9',
  actorBorder: '#cbd5e0',
  actorTextColor: '#1e293b',
  actorLineColor: '#cbd5e0',
  signalColor: '#94a3b8',
  signalTextColor: '#1e293b',
  labelBoxBkgColor: '#f1f5f9',
  labelBoxBorderColor: '#cbd5e0',
  labelTextColor: '#1e293b',
  loopTextColor: '#475569',
  noteBkgColor: '#f1f5f9',
  noteBorderColor: '#cbd5e0',
  noteTextColor: '#475569',
  activationBkgColor: '#e2e8f0',
  activationBorderColor: '#cbd5e0',
  sequenceNumberColor: '#1e293b',
  labelColor: '#1e293b',
  altBackground: '#e2e8f0',
  compositeBackground: '#e2e8f0',
  compositeBorder: '#cbd5e0',
  compositeTitleBackground: '#f1f5f9',
  transitionColor: '#94a3b8',
  transitionLabelColor: '#475569',
  stateLabelColor: '#1e293b',
  stateBkg: '#f1f5f9',
  edgeLabelColor: '#475569',
};

/** Import mermaid once, (re-)initialize only when theme changes. */
async function getMermaid(isDark: boolean) {
  if (!mermaidMod) {
    mermaidMod = (await import('mermaid')).default;
  }
  if (lastIsDark !== isDark) {
    mermaidMod.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      fontSize: 24,
      themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
      flowchart: { curve: 'monotoneX', padding: 16, nodeSpacing: 40, rankSpacing: 50 },
      sequence: { mirrorActors: false, messageMargin: 40, boxMargin: 10, noteMargin: 10, actorMargin: 50 },
      state: { padding: 10, dividerMargin: 10 },
    });
    lastIsDark = isDark;
  }
  return mermaidMod;
}

/** Inject text-colour overrides into the rendered SVG. */
function patchSvg(raw: string): string {
  // We intentionally leave Mermaid's native SVG width/height/viewBox/style
  // attributes untouched. Mermaid v11 outputs sensible `max-width` + `viewBox`
  // that browsers can compute intrinsic size from. Manipulating those attributes
  // causes height collapse in flex containers or oversized diagrams.
  const textFill = '#1e293b';
  const labelFill = '#475569';
  const patchStyle = `<style>
    text, tspan { fill: ${textFill}; }
    .edgeLabel, .edgeLabel span, .edgeLabel p,
    .label, .label span, .label div,
    .edgeTerminals text,
    .messageText, .labelText { color: ${labelFill}; fill: ${labelFill}; }
    .node .label, .node .label div { color: ${textFill}; font-weight: 600; }
    .node foreignObject { overflow: visible; }
    .node foreignObject > div,
    .node foreignObject body,
    .node .label {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      margin: 0 !important;
    }
    .actor { font-weight: 600; }
    text.actor-label, .actor text { font-weight: 600; }
    .cluster-label text { fill: ${textFill}; font-weight: 600; }
    .transition { stroke: #94a3b8; }
  </style>`;
  return raw.replace(/<style>/, patchStyle + '<style>');
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '_');
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    // Chain onto the global queue so only one render executes at a time.
    renderQueue = renderQueue
      .then(async () => {
        if (cancelled) return;
        const isDark = document.documentElement.classList.contains('dark');
        const mermaid = await getMermaid(isDark);

        const { svg: rendered } = await mermaid.render(
          `mermaid-${id}`,
          chart.trim(),
        );
        if (!cancelled) {
          setSvg(patchSvg(rendered));
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Mermaid render failed';
          setError(msg);
          console.error('Mermaid render error:', msg);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="p-3 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg overflow-auto border border-red-200 dark:border-red-800">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 overflow-x-auto rounded-lg border border-fd-border bg-fd-card/50 dark:bg-slate-100 px-4 py-3"
    >
      {svg ? (
        <div
          className="flex justify-center"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex items-center justify-center py-6 text-fd-muted-foreground text-sm">
          Loading diagram…
        </div>
      )}
    </div>
  );
}
