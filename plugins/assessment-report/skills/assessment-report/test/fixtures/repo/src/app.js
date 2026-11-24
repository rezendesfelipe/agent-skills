export function total(items) {
  return items.reduce((a, b) => a + b.price, 0);
}

export const VERSION = "1.0";
