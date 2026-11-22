// Aligns "=" in runs of consecutive single-line attributes, as terraform fmt does,
// so generated files pass `terraform fmt -check` without Terraform installed.
const ATTR = /^(\s*)([A-Za-z_][\w-]*|\(.*\)|"[^"]*")(\s*)=\s(.*)$/;

export function formatHcl(text) {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const group = [];
    let indent = null;
    while (i < lines.length) {
      const m = ATTR.exec(lines[i]);
      const opens = m && /[{[(]\s*(#.*)?$/.test(m[4]) && !/^\[.*\]\s*(#.*)?$/.test(m[4]) && !/^\{.*\}\s*(#.*)?$/.test(m[4]);
      if (!m || opens || (indent !== null && m[1] !== indent)) break; // a multi-line value ends the run and is not aligned
      indent = m[1];
      group.push({ idx: i, key: m[2], value: m[4] });
      i++;
    }
    if (group.length) {
      const width = Math.max(...group.map((g) => g.key.length));
      for (const g of group) lines[g.idx] = `${indent}${g.key.padEnd(width)} = ${g.value}`;
    } else i++;
  }
  return lines.join("\n");
}
