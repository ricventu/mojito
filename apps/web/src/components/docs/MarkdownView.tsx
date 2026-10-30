import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";
import { classifyHref } from "@/lib/docs/links";
import { docsHref } from "@/lib/docs/url";

interface Props {
  content: string;
  project: string;
  ticket: string | null;
  /** The document's own path: relative links resolve against its directory. */
  path: string;
}

/**
 * A document rendered. Raw HTML in the markdown is not rendered (react-markdown's default, no
 * `rehype-raw`), so nothing here needs sanitizing. Images show their alt text only: a relative one
 * would need a file route, a remote one a fetch nobody asked for.
 */
export function MarkdownView({ content, project, ticket, path }: Props) {
  const components: Components = {
    a: ({ href, title, children }) => {
      const link = classifyHref(href, path);
      switch (link.kind) {
        case "external":
          return (
            <a href={link.href} title={title} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        case "mail":
          return (
            <a href={link.href} title={title}>
              {children}
            </a>
          );
        case "doc":
          return (
            <Link to={docsHref(project, { ticket, path: link.path })} title={title}>
              {children}
            </Link>
          );
        default:
          return <span title={title}>{children}</span>;
      }
    },
    img: ({ alt }) => (alt ? <span className="text-muted-foreground italic">[{alt}]</span> : null),
    // Wide code and tables scroll inside their own box; the page never pans.
    pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
  };
  return (
    // Inline code loses the plugin's literal backticks for a tint; code inside `pre` keeps the block's look.
    <div className="prose prose-sm max-w-none wrap-break-word sm:prose-base dark:prose-invert prose-code:font-normal prose-code:before:content-none prose-code:after:content-none [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
