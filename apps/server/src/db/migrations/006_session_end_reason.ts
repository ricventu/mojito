// Why a session ended (`EndReason`), so an ended row says whether it was closed or killed.
export default `
ALTER TABLE sessions ADD COLUMN end_reason TEXT;
`;
