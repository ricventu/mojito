// The name claude gives a session (`/rename`, else its automatic title), read from tmux.
export default `
ALTER TABLE sessions ADD COLUMN title TEXT;
`;
