'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '_');
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const isDark = document.documentElement.classList.contains('dark');

        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'loose',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          fontSize: 13,
          themeVariables: isDark
            ? {
                // Dark mode — light container bg, so use dark text everywhere
                // Core
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
                // Flowchart
                defaultLinkColor: '#94a3b8',
                // Sequence diagram
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
                // State diagram
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
                // Edge labels
                edgeLabelColor: '#475569',
              }
            : {
                // Light mode — clean neutral
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
                // Sequence diagram
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
                // State diagram
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
              },
          flowchart: { curve: 'monotoneX', padding: 12, nodeSpacing: 30, rankSpacing: 40 },
          sequence: { mirrorActors: false, messageMargin: 30, boxMargin: 8, noteMargin: 8, actorMargin: 40 },
          state: { padding: 8, dividerMargin: 8 },
        });

        const { svg: rendered } = await mermaid.render(
          `mermaid-${id}`,
          chart.trim(),
        );

        if (!cancelled) {
          // Post-process: inject a <style> block into the SVG to guarantee text
          // visibility. Mermaid sets inline fills on some elements but misses
          // others (edge labels use <foreignObject> with default black text,
          // state transition labels, etc.). The injected CSS uses !important
          // only as a last-resort to override hard-coded inline styles.
          // Container is always light (dark:bg-slate-100), so all text
          // uses dark fills regardless of page theme.
          const textFill = '#1e293b';
          const labelFill = '#475569';
          const patchStyle = `<style>
            text, tspan { fill: ${textFill}; }
            .edgeLabel, .edgeLabel span, .edgeLabel p,
            .label, .label span, .label div,
            .edgeTerminals text,
            .messageText, .labelText { color: ${labelFill}; fill: ${labelFill}; }
            .node .label, .node .label div { color: ${textFill}; }
            .node foreignObject { overflow: visible; }
            .node foreignObject > div,
            .node foreignObject body,
            .node .label {
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              height: 100% !important;
              margin: 0 !important;
            }
            .cluster-label text { fill: ${textFill}; }
            .transition { stroke: #94a3b8; }
          </style>`;
          const patched = rendered.replace(/<style>/, patchStyle + '<style>');
          setSvg(patched);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Mermaid render failed';
          setError(msg);
          console.error('Mermaid render error:', msg);
        }
      }
    })();

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

  if (!svg) {
    return (
      <div className="flex items-center justify-center py-6 text-fd-muted-foreground text-sm">
        Loading diagram…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto rounded-lg border border-fd-border bg-fd-card/50 dark:bg-slate-100 px-4 py-3 [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
