import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { corretoresParaRateio } from "@/lib/fechamento";
import { montarEndereco, type ImovelEndereco } from "@/lib/imovel-endereco";

/**
 * Dados do negócio pelo NÚMERO DO CONTRATO do Kurole — pedido da Suzana em
 * 28/09/2026: ela digita o CT e quer a referência, o endereço do imóvel e o
 * captador vindos prontos, em vez de procurar cada um na tela do KSI.
 *
 * O número do contrato é `conversao.CtrCod`, NÃO o id da conversão: a
 * conversão 10703 é o contrato 4415. Venda e locação têm sequências separadas,
 * então o mesmo número existe nas duas — a chave é número + vertical, única
 * nas 4.416 conversões conferidas. Como o fechamento é sempre de uma vertical,
 * o `tipo` vem do período e a busca nunca fica ambígua.
 *
 * Devolve também quem recebe comissão do contrato no Kurole
 * (`conversao_corretores`), que é o rateio de lá — serve de conferência contra
 * o rateio que a adm monta aqui, sem sobrescrevê-lo.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const numero = Number((req.nextUrl.searchParams.get("numero") || "").replace(/\D/g, ""));
  const tipo = req.nextUrl.searchParams.get("tipo");
  if (!numero) return NextResponse.json({ error: "número de contrato inválido" }, { status: 400 });
  if (tipo !== "venda" && tipo !== "locacao") {
    return NextResponse.json({ error: "tipo precisa ser venda ou locacao" }, { status: 400 });
  }
  const letra = tipo === "venda" ? "V" : "L";

  const sql = getDb();
  const [conv] = await sql`
    SELECT c.id, c.imovel_id, c.valor, c.taxa, c.comissao_valor, c.locacao_venda, c.unidade_id,
           c.data_inicio, c.data_assinatura, c.data_efetivacao,
           i.endereco, i.numero, i.complemento, i.compl_blocos, i.unidade_imovel,
           i.quadra, i.lote, i.bairro
    FROM conversoes c
    LEFT JOIN imoveis i ON i.id = c.imovel_id
    WHERE c.contrato_numero = ${numero} AND c.locacao_venda = ${letra}
  `;
  if (!conv) {
    return NextResponse.json(
      { error: `contrato ${numero} não encontrado em ${tipo === "venda" ? "vendas" : "locação"}` },
      { status: 404 }
    );
  }

  // Captadores do imóvel: é o que alimenta o bloco Levantamento, mesma regra
  // que a busca por referência já usa.
  const captadores = (await sql`
    SELECT corretor_id, SUM(percentual) AS percentual
    FROM imovel_captadores
    WHERE imovel_id = ${conv.imovel_id} AND locacao_venda = ${letra}
      AND removido_em IS NULL
    GROUP BY corretor_id
    ORDER BY SUM(percentual) DESC
  `) as { corretor_id: number; percentual: string | null }[];

  const elegiveis = new Map((await corretoresParaRateio(sql)).map((c) => [c.id, c.nome]));
  const dentro = captadores.filter((c) => elegiveis.has(Number(c.corretor_id)));

  // Quem o Kurole registra recebendo comissão deste contrato.
  /*
   * GROUP BY corretor, e não uma linha por registro: o Kurole tem o mesmo
   * corretor lançado duas vezes no mesmo negócio (o dashboard já convive com
   * isso com um DISTINCT). Sem agrupar, o Fechamento vinha com a mesma pessoa
   * repetida e 30% + 30% = 60% da comissão.
   *
   * O percentual é somado porque duas linhas de 50% são a mesma participação
   * partida em duas — somar devolve os 100% que ela realmente vale.
   *
   * Linha apagada no Kurole não entra: `removido_em IS NULL`.
   */
  const comissionados = (await sql`
    SELECT cc.corretor_id, SUM(cc.percentual) AS percentual,
      COALESCE(NULLIF(TRIM(k.nome_comercial), ''), NULLIF(TRIM(k.nome), ''),
               initcap(replace(split_part(COALESCE(k.email, ''), '@', 1), '.', ' '))) AS nome
    FROM conversao_corretores cc
    LEFT JOIN corretores k ON k.id = cc.corretor_id
    WHERE cc.conversao_id = ${conv.id} AND cc.removido_em IS NULL
    GROUP BY cc.corretor_id, k.nome_comercial, k.nome, k.email
    ORDER BY SUM(cc.percentual) DESC NULLS LAST
  `) as { corretor_id: number; percentual: string | null; nome: string | null }[];

  return NextResponse.json({
    contrato: numero,
    conversao_id: conv.id,
    // A referência do imóvel é o próprio id — é assim que a adm digita hoje.
    ref: conv.imovel_id ? String(conv.imovel_id) : null,
    endereco: conv.imovel_id ? montarEndereco(conv as unknown as ImovelEndereco) : null,
    valor: conv.valor != null ? Number(conv.valor) : null,
    taxa: conv.taxa != null ? Number(conv.taxa) : null,
    /*
     * `taxa_valor` do Kurole = valor × taxa. Serve para VENDA, onde é a
     * comissão — o contrato 239 traz 26.100,00, exatamente o que a adm digitou
     * na ref 2949.
     *
     * Em LOCAÇÃO não serve: ali `taxa_valor` é a taxa ADMINISTRATIVA mensal, e
     * o que entra no fechamento é a TAXA DE LOCAÇÃO, que é o `valor` acima.
     * Quem escolhe entre os dois é o formulário, que sabe a vertical.
     */
    comissao_valor: conv.comissao_valor != null ? Number(conv.comissao_valor) : null,
    data_assinatura: conv.data_assinatura,
    data_inicio: conv.data_inicio,
    captadores: dentro.map((c) => ({
      corretor_id: Number(c.corretor_id),
      nome: elegiveis.get(Number(c.corretor_id))!,
      percentual: c.percentual != null ? Number(c.percentual) : null,
    })),
    captadores_fora: captadores.length - dentro.length,
    comissionados: comissionados.map((c) => ({
      corretor_id: c.corretor_id,
      nome: c.nome ?? `corretor ${c.corretor_id}`,
      percentual: c.percentual != null ? Number(c.percentual) : null,
    })),
  });
}
