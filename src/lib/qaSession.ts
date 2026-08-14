// Which session affordances the To QA gate offers, given the ticket's work session. Pure so it
// can be tested without a render harness, following qaGateModel and terminalHeadModel.

export interface QaSessionModel {
  /** Open the work session — its scrollback is worth reading whether or not it still runs. */
  open: boolean;
  /**
   * Start a fresh work session. Offered whenever nothing is alive to type into: a
   * registered-but-dead session (killed pane, machine restarted) would otherwise leave the
   * gate with no way forward. Starting never replaces a live session — if the tmux name is
   * still held, the launch answers 409 and the user is told to kill it first.
   */
  start: boolean;
}

export function qaSessionModel(input: { registered: boolean; active: boolean }): QaSessionModel {
  return { open: input.registered, start: !input.active };
}
