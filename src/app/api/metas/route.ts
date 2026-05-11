import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const sql = getDb();
  const metas = await sql`SELECT * FROM metas ORDER BY mes DESC LIMIT 12`;
  return NextResponse.json(metas);
}

export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = await req.json();

  const result = await sql`
    INSERT INTO metas (mes, leads_meta, visitas_meta, propostas_meta, vendas_meta, locacoes_meta, receita_meta, budget_meta, cpl_meta)
    VALUES (${body.mes}, ${body.leads_meta || 0}, ${body.visitas_meta || 0}, ${body.propostas_meta || 0}, ${body.vendas_meta || 0}, ${body.locacoes_meta || 0}, ${body.receita_meta || 0}, ${body.budget_meta || 0}, ${body.cpl_meta || 0})
    ON CONFLICT (mes) DO UPDATE SET
      leads_meta=EXCLUDED.leads_meta, visitas_meta=EXCLUDED.visitas_meta,
      propostas_meta=EXCLUDED.propostas_meta, vendas_meta=EXCLUDED.vendas_meta,
      locacoes_meta=EXCLUDED.locacoes_meta, receita_meta=EXCLUDED.receita_meta,
      budget_meta=EXCLUDED.budget_meta, cpl_meta=EXCLUDED.cpl_meta
    RETURNING *`;

  return NextResponse.json(result[0]);
}
