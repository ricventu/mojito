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
          // Same rule as the terminal's WebLinksAddon, but scoped to schemes that are
          // actually safe to leave the app for: http(s) links open in a new tab, a
          // mailto link opens the mail client in place, and anything else (a relative
          // path, a bare #anchor, a missing href) renders as inert text — a relative
          // .md link would navigate this single-page app to a 404 and tear down the
          // live terminal WebSocket behind the viewer, which is worse than not linking.
          a: ({ href, title, children }) => {
            const scheme = href?.toLowerCase() ?? "";
            if (scheme.startsWith("http:") || scheme.startsWith("https:")) {
              return (
                <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            }
            if (scheme.startsWith("mailto:")) {
              return <a href={href} title={title}>{children}</a>;
            }
            return <a title={title}>{children}</a>;
          },
          // A wide table must scroll inside its own box; the page never pans.
          table: ({ children }) => <div className="doc-table"><table>{children}</table></div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
