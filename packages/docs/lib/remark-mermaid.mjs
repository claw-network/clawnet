/**
 * Remark plugin that transforms ```mermaid code blocks into <Mermaid chart="..." /> JSX elements.
 * This runs BEFORE Fumadocs' Shiki syntax highlighting, so mermaid blocks are never
 * processed as code — they become React components instead.
 */

/** @type {import('unified').Plugin} */
export function remarkMermaid() {
  return (tree) => {
    visitCodeBlocks(tree);
  };
}

/**
 * Recursively walk the MDAST tree and replace code blocks with lang="mermaid"
 * with mdxJsxFlowElement nodes.
 */
function visitCodeBlocks(node) {
  if (!node.children) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    if (child.type === 'code' && child.lang === 'mermaid') {
      // Replace the code node with an MDX JSX element: <Mermaid chart="..." />
      node.children[i] = {
        type: 'mdxJsxFlowElement',
        name: 'Mermaid',
        attributes: [
          {
            type: 'mdxJsxAttribute',
            name: 'chart',
            value: child.value,
          },
        ],
        children: [],
        data: { _mdxExplicitJsx: true },
      };
    } else {
      // Recurse into child nodes
      visitCodeBlocks(child);
    }
  }
}
