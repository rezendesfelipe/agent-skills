export function saveInvoice(db, invoice) {
  return db.query("INSERT INTO invoices (id, customer_id, total) VALUES ($1, $2, $3)", [invoice.id, invoice.customerId, invoice.total]);
}

export function findInvoice(db, id) {
  return db.query("SELECT id, customer_id, total FROM invoices WHERE id = $1", [id]);
}
