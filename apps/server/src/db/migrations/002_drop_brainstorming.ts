// Brainstorming stopped being a launch option: the session decides from the ticket.
export default `
ALTER TABLE sessions DROP COLUMN brainstorming;
DELETE FROM settings WHERE key = 'brainstormingDefault';
`;
