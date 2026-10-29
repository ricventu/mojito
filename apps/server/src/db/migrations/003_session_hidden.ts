// A session can be tucked into the sidebar's Hidden footer; sidebar-only, nothing behavioural reads it.
export default `
ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
`;
