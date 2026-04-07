'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface PreviewPaneProps {
  content: string;
  jumpToHeadingToken?: string;
  scrollToText?: string | null;
}

// Main component export: this is the entry point rendered by parent routes/components.
export default function PreviewPane({ content, jumpToHeadingToken, scrollToText }: PreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jumpToHeadingToken) return;
    const heading = jumpToHeadingToken.split('::').slice(1).join('::').trim().toLowerCase();
    if (!heading) return;

    const root = containerRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const exact = candidates.find((node) => node.textContent?.trim().toLowerCase() === heading);
    const partial = candidates.find((node) => node.textContent?.trim().toLowerCase().includes(heading));
    const target = exact ?? partial;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [jumpToHeadingToken]);

  useEffect(() => {
    const token = scrollToText?.trim().toLowerCase();
    if (!token) return;

    const root = containerRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>(
      'p, li, blockquote, pre, code, h1, h2, h3, h4, h5, h6',
    ));
    const exact = candidates.find((node) => node.textContent?.trim().toLowerCase() === token);
    const partial = candidates.find((node) => node.textContent?.trim().toLowerCase().includes(token));
    const target = exact ?? partial;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [content, scrollToText]);

  if (!content.trim()) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm bg-white dark:bg-gray-950 overflow-y-auto">
        Nothing to preview
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto bg-white dark:bg-gray-950 px-6 py-6">
      <article className="prose prose-gray dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
