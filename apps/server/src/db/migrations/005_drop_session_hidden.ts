// The sidebar's Hide went away: nothing reads or writes `hidden` any more.
export default `
ALTER TABLE sessions DROP COLUMN hidden;
`;
