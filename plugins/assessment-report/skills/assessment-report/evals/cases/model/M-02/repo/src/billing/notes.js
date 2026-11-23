// TODO: the old version built the query by string concatenation:
//   db.query("SELECT * FROM invoices WHERE id = '" + id + "'")
// It was replaced by the parameterized query in store.js. Do not bring it back.
export const NOTE = "see store.js";
