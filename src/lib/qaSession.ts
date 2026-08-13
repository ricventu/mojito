// Which session affordances the To QA gate offers, given the ticket's work session. Pure so it
// can be tested without a render harness, following qaGateModel and terminalHeadModel.

export interface QaSessionModel {
  /** Open the work session — its scrollback is worth reading whether or not it still runs. */
  open: boolean;
  /**
   * Start a fresh work session. Offered whenever nothing is alive to type into: registry
   * entries are never dropped automatically, so a registered-but-dead session (killed pane,
   * superseded by a conflict verdict) would otherwise leave the gate with no way forward.
   */
  start: boolean;
}

export function qaSessionModel(input: { registered: boolean; active: boolean }): QaSessionModel {
  return { open: input.registered, start: !input.active };
}
