import { randomUUID } from "node:crypto";

const ROUND = (n) => Math.round(n * 100) / 100;

export function createInvoice(customerId, lines) {
  if (!customerId || typeof customerId !== "string") throw new Error("customerId is required");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("an invoice needs at least one line");
  const items = lines.map((l) => ({ sku: String(l.sku), qty: Number(l.qty), price: ROUND(Number(l.price)) }));
  for (const i of items) if (!(i.qty > 0) || !(i.price >= 0)) throw new Error(`invalid line for ${i.sku}`);
  const total = ROUND(items.reduce((sum, i) => sum + i.qty * i.price, 0));
  return { id: randomUUID(), customerId, items, total };
}
