"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// react-markdown does not render raw HTML embedded in the markdown unless
// rehype-raw is added, so there is no dangerouslySetInnerHTML here and no
// sanitizer to keep in step with it.
export default function MarkdownDoc({ content }: { content: string }) {
  return (
    <div className="doc-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Same rule as the terminal's WebLinksAddon: links leave for a new tab.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          // A wide table must scroll inside its own box; the page never pans.
          table: ({ children }) => <div className="doc-table"><table>{children}</table></div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
