import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * Avisos do quadro de contratos para quem está logado (05/10/2026).
 *
 * É o que alimenta o sino do BI. Quem recebe hoje é o setor de contratos,
 * quando o gerente confere e move o card — ver `avisarContratosDoMovimento`.
 *
 * A consulta é sempre pela SESSÃO, nunca por um id vindo da requisição: aviso
 * é correspondência, e ler a de outra pessoa não pode ser uma questão de
 * trocar um número na URL.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const avisos = (await sql`
    SELECT n.id, n.contrato_id, n.titulo, n.texto, n.criado_em, c.senha, c.ref
    FROM contrato_notificacoes n
    JOIN contratos c ON c.id = n.contrato_id
    WHERE n.usuario_id = ${session.id} AND n.lida_em IS NULL
    ORDER BY n.id DESC
    LIMIT 20
  `) as Record<string, unknown>[];

  return NextResponse.json({ avisos });
}

/**
 * Marca como lido. Sem corpo, limpa tudo; com `{ ids: [...] }`, só aqueles.
 *
 * O `usuario_id = session.id` no WHERE não é redundante com o id do aviso: sem
 * ele, qualquer pessoa marcaria como lida a notificação de outra, que some do
 * sino dela sem nunca ter sido vista.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids)
    ? body.ids.map(Number).filter(Number.isInteger)
    : null;

  const sql = getDb();
  if (ids && ids.length) {
    await sql`
      UPDATE contrato_notificacoes SET lida_em = NOW()
      WHERE usuario_id = ${session.id} AND lida_em IS NULL AND id = ANY(${ids}::int[])
    `;
  } else {
    await sql`
      UPDATE contrato_notificacoes SET lida_em = NOW()
      WHERE usuario_id = ${session.id} AND lida_em IS NULL
    `;
  }

  return NextResponse.json({ ok: true });
}
