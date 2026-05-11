export function fmtMoney(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtNum(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "0";
  return n.toLocaleString("pt-BR");
}

export function fmtPct(v: number | string, decimals = 1): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "0%";
  return `${n.toFixed(decimals)}%`;
}

export function fmtDate(v: string): string {
  if (!v) return "-";
  const d = new Date(v);
  return d.toLocaleDateString("pt-BR");
}

export function getStatus(
  value: number,
  meta: number,
  invert = false
): "ok" | "atencao" | "critico" | null {
  if (!meta || meta === 0) return null;
  const pct = value / meta;
  if (invert) {
    if (pct <= 1) return "ok";
    if (pct <= 1.3) return "atencao";
    return "critico";
  }
  if (pct >= 0.8) return "ok";
  if (pct >= 0.5) return "atencao";
  return "critico";
}
