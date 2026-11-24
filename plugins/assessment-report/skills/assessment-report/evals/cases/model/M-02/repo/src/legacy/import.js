export function importRow(db, row) {
  return db.query("INSERT INTO invoices VALUES ('" + row.id + "', '" + row.customer + "', " + row.total + ")");
}
