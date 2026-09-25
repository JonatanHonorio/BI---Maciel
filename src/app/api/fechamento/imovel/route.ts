import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { corretoresParaRateio } from "@/lib/fechamento";
// Mesma montagem usada pelo card de contrato — uma cópia só pra não divergirem.
import { montarEndereco, type ImovelEndereco } from "@/lib/imovel-endereco";

/**
 * Dados do imóvel pela referência, pra preencher sozinho o endereço e o
 * Levantamento no formulário de fechamento (captação e levantamento são a
 * mesma coisa, então o captador do Kurole é quem entra nesse bloco).
 *
 * A ref é digitada de jeitos diferentes ("58298", "L58808", "V 58298") mas o
 * número é sempre o id do imóvel — `imoveis.codigo` está gravado como "0" na
 * maior parte da base, não serve de chave.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ref = req.nextUrl.searchParams.get("ref") || "";
  const tipo = req.nextUrl.searchParams.get("tipo"); // 'venda' | 'locacao'
  const id = Number(ref.replace(/\D/g, ""));
  if (!id) return NextResponse.json({ error: "ref inválida" }, { status: 400 });

  const sql = getDb();
  const [imovel] = await sql`
    SELECT id, endereco, numero, complemento, compl_blocos, unidade_imovel,
           quadra, lote, bairro, cidade, valor, valor_locacao
    FROM imoveis WHERE id = ${id}
  `;
  if (!imovel) return NextResponse.json({ error: "imóvel não encontrado" }, { status: 404 });

  // locacao_venda do captador é 'V'/'L'; sem tipo, traz os dois.
  const letra = tipo === "venda" ? "V" : tipo === "locacao" ? "L" : null;
  const captadores = (await sql`
    SELECT corretor_id, percentual, locacao_venda
    FROM imovel_captadores
    WHERE imovel_id = ${id} AND (${letra}::text IS NULL OR locacao_venda = ${letra})
    ORDER BY percentual DESC
  `) as { corretor_id: number; percentual: string | null; locacao_venda: string }[];

  // Só devolve quem pode receber rateio — quem não estiver na lista sai com
  // aviso, pra adm escolher na mão em vez de o campo vir errado calado.
  const elegiveis = new Map((await corretoresParaRateio(sql)).map((c) => [c.id, c.nome]));
  const dentro = captadores.filter((c) => elegiveis.has(Number(c.corretor_id)));
  const fora = captadores.length - dentro.length;

  return NextResponse.json({
    endereco: montarEndereco(imovel as unknown as ImovelEndereco),
    valor: imovel.valor,
    valor_locacao: imovel.valor_locacao,
    captadores: dentro.map((c) => ({
      corretor_id: Number(c.corretor_id),
      nome: elegiveis.get(Number(c.corretor_id))!,
      percentual: c.percentual != null ? Number(c.percentual) : null,
    })),
    captadores_fora: fora,
  });
}
