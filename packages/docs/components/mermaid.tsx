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
        // Dynamic import to avoid SSR issues
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });

        const { svg: rendered } = await mermaid.render(
          `mermaid-${id}`,
          chart.trim(),
        );

        if (!cancelled) {
          setSvg(rendered);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          console.error('Mermaid render error:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="p-4 text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg overflow-auto">
        <code>{chart}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center p-8 text-fd-muted-foreground text-sm">
        Loading diagram…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
