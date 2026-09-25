import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeEditarContrato, podeVerBanco, unidadesContrato, tiposContrato } from "@/lib/contratos";
import { limparContrato, validarBase, json, type CorpoContrato } from "@/lib/contratos-api";
import { UNIDADES_FECHAMENTO } from "@/lib/fechamento";

/**
 * Quadro do setor de contratos.
 *
 * O escopo é aplicado no SQL (e não peneirando depois) pra que dado de unidade
 * que a pessoa não pode ver nem saia do banco.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const unidades = unidadesContrato(session);
  const tipos = tiposContrato(session);
  const arquivados = req.nextUrl.searchParams.get("arquivados") === "1";

  const linhas = (await sql`
    SELECT c.*, u.nome AS criado_por_nome
    FROM contratos c
    LEFT JOIN usuarios_bi u ON u.id = c.criado_por
    WHERE c.arquivado = ${arquivados}
      AND (${unidades}::text[] IS NULL OR c.unidade = ANY(${unidades}::text[]))
      AND (${tipos}::text[] IS NULL OR c.tipo = ANY(${tipos}::text[]))
    ORDER BY c.fase, c.atualizado_em DESC
  `) as Record<string, unknown>[];

  const verBanco = podeVerBanco(session);
  return NextResponse.json({
    contratos: linhas.map((c) => limparContrato(c, verBanco)),
    // `unidades` é o escopo de quem pediu; `todasUnidades` é a lista oficial
    // para o seletor do formulário — o componente é client e não pode importar
    // @/lib/fechamento, que usa fs.
    permissoes: { editar: podeEditarContrato(session), verBanco, unidades, tipos },
    todasUnidades: UNIDADES_FECHAMENTO,
  });
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!podeEditarContrato(session)) {
    return NextResponse.json({ error: "só o setor de contratos cria card" }, { status: 403 });
  }

  const body = (await req.json()) as CorpoContrato;
  const erro = validarBase(body);
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  const sql = getDb();
  const [novo] = (await sql`
    INSERT INTO contratos (
      ref, imovel_id, tipo, unidade, corretor_id, corretor_nome, fase,
      vendedor, comprador, imovel_endereco, imovel_dados, banco,
      pagamento, observacao, criado_por, atualizado_por
    ) VALUES (
      ${body.ref!.trim()}, ${body.imovel_id ?? null}, ${body.tipo!}, ${body.unidade!},
      ${body.corretor_id ?? null}, ${body.corretor_nome ?? ""}, ${body.fase ?? 1},
      ${json(body.vendedor, "[]")}, ${json(body.comprador, "[]")},
      ${body.imovel_endereco ?? null}, ${json(body.imovel_dados, "{}")},
      ${json(body.banco, "{}")}, ${body.pagamento ?? null}, ${body.observacao ?? null},
      ${session.id}, ${session.id}
    ) RETURNING *
  `) as Record<string, unknown>[];

  await sql`
    INSERT INTO contrato_eventos (contrato_id, de, para, comentario, criado_por, criado_por_nome)
    VALUES (${novo.id as number}, NULL, ${novo.fase as number}, 'Card criado', ${session.id}, ${session.nome})
  `;

  return NextResponse.json({ contrato: limparContrato(novo, podeVerBanco(session)) });
}
