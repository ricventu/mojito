"use client";
import { ticketLinkUrl } from "@/lib/ticketLink";

/**
 * A ticket id label: an anchor to the issue on Linear when Mojito has its url, the
 * plain `.id` span it has always been when it does not (see ticketLinkUrl). Every
 * place that shows an identifier goes through here — the board cards, the launch
 * sheet, the terminal header — so the affordance is the same one everywhere.
 *
 * A new tab, always: from the terminal, navigating away would drop the pty socket,
 * and from the board it would cost the filters and scroll position of the page the
 * human is working from.
 *
 * Callers must keep this *outside* their tap region, never nested in one. A
 * `role="button"` element's children are presentational as far as ARIA is
 * concerned, so a link inside `.tap` is announced as part of the button and cannot
 * be reached on its own — the same nesting rule that made those regions divs
 * instead of buttons in the first place (see tapProps).
 */
export default function TicketLink({ id, url }: { id: string; url?: string | null }) {
  const href = ticketLinkUrl(url);
  if (!href) return <span className="id">{id}</span>;
  return (
    <a
      className="id"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${id} in Linear`}
    >
      {id}
    </a>
  );
}
