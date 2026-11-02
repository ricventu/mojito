// claude's own conversation id, from the hooks: what Resume passes to `claude --resume`.
export default `
ALTER TABLE sessions ADD COLUMN claude_session_id TEXT;
`;
