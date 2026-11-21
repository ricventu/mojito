# Label filter on the board (RIC-609)

## Intent

The board's Filters sheet offers Projects, Status and Sessions; a ticket's labels are only
reachable through the text search, which also matches titles. A Labels section lets the human
narrow the board to, say, every `Bug` across projects.

## Goals / non-goals

- Goal: a Labels section in the Filters sheet, url-backed like the others, saved in favourites.
- Non-goal: any server change, or fetching Linear's label list.
- Anti-goal: a filter that hides a match (in a closed Backlog) or offers labels that match nothing.

## Approaches

- **Labels from the board's tickets (picked):** the union of `labels` over the loaded tickets,
  plus any selected label no longer on the board (as `sheetProjects`). No new request, colours
  already there (RIC-608), and every offered label matches something.
- Linear's team labels through a new endpoint: offers labels no ticket on the board carries
  (they match nothing), costs a server route and a peer question — rejected.

## Design

- `BoardFilters.labels: string[]`, url `label=` repeated, normalised like projects (deduped,
  plain `sort()`, not locale). Counted by `filterCount`, part of `isFiltered`.
- Matching is **any** of the selected labels (OR), as Projects and Status. Case-sensitive, by name.
- `filterBoard`: a label filter keeps tickets carrying one of them, hides loose sessions (they
  have no labels), opens Backlog (`backlogOpen`), and counts as narrowing (empty sections drop).
- Sheet: a "Labels" fieldset after Status — toggle chips, each with its Linear colour dot
  (`labelColor`), labels sorted by `localeCompare(…, "en")` for display. "No labels" when none.
- `favoriteName`: labels after statuses; more than two become `N labels`.
