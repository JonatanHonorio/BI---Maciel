import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  competenciaAtual, calcularStatusPagamento, negociosDaCompetencia,
} from "@/lib/fechamento";
import { ROTULO_PAPEL, type Papel } from "@/lib/comissao";
import { podeLancarComissao, unidadesFechamento, tiposFechamento } from "@/lib/permissoes";

const LABEL_STATUS = { pendente: "Pendente", parcial: "Parcial", pago: "Pago" } as const;
const DINHEIRO = "R$ #,##0.00";

/**
 * Excel das comissões de uma faixa de competências, em duas abas:
 *
 *   Negócios        uma linha por rateio — quem recebe, de qual negócio,
 *                   quanto é devido e quanto já foi pago
 *   Por destinatário o resumo que a adm usa pra pagar: total por pessoa
 *
 * Uma linha POR RATEIO na primeira aba, e não por negócio, porque o pagamento
 * é feito por destinatário: juntar tudo num campo de texto ("Fulano, Beltrano")
 * obrigaria a abrir o BI pra saber quanto cabe a cada um.
 *
 * Usa `negociosDaCompetencia`, a mesma consulta da tela — o Excel não pode
 * mostrar número diferente do que está na tela.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unidades = unidadesFechamento(session);
  const tipos = tiposFechamento(session);
  if (unidades?.length === 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Faixa de competências. Sem parâmetro, o mês corrente — a tela abre no mês,
  // e quem quiser o ano inteiro amplia. `ate` sozinho vale como `de`, e
  // vice-versa, pra não devolver vazio quando só um lado vem preenchido.
  const p = req.nextUrl.searchParams;
  const de = p.get("de") || p.get("competencia") || competenciaAtual();
  const ate = p.get("ate") || p.get("competencia") || de;
  const negocios = await negociosDaCompetencia(getDb(), de, ate, unidades, tipos);

  const wb = new ExcelJS.Workbook();

  // ---------------------------------------------------------- aba Negócios
  const ws = wb.addWorksheet("Negócios");
  ws.addRow([
    "Unidade", "Tipo", "Ref", "Endereço", "Comissão do negócio",
    "Destinatário", "Papel", "%", "Devido", "Pago", "Pendente", "Status",
  ]);

  const porDestinatario = new Map<string, {
    nome: string; papeis: Set<string>; negocios: number; devido: number; pago: number;
  }>();

  for (const n of negocios) {
    const pool = n.tipo === "venda" ? n.comissao : n.valor;
    const calc = calcularStatusPagamento(pool, n.rateio);
    for (const { linha, valorDevido, valorPago } of calc.rateio) {
      ws.addRow([
        n.unidade, n.tipo === "venda" ? "Vendas" : "Locação", n.ref, n.endereco,
        calc.pool || null,
        linha.nome, ROTULO_PAPEL[linha.papel as Papel] ?? linha.papel,
        linha.percentual != null ? Number(linha.percentual) : null,
        valorDevido, valorPago, (valorDevido ?? 0) - valorPago,
        LABEL_STATUS[calc.status],
      ]);

      const chave = linha.corretor_id != null ? `c${linha.corretor_id}` : `r:${linha.nome}`;
      const atual = porDestinatario.get(chave)
        ?? { nome: linha.nome, papeis: new Set<string>(), negocios: 0, devido: 0, pago: 0 };
      atual.papeis.add(ROTULO_PAPEL[linha.papel as Papel] ?? linha.papel);
      atual.negocios += 1;
      atual.devido += valorDevido ?? 0;
      atual.pago += valorPago;
      porDestinatario.set(chave, atual);
    }
  }

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: { row: 1, column: 12 } };
  for (const c of [5, 9, 10, 11]) ws.getColumn(c).numFmt = DINHEIRO;
  ws.getColumn(8).numFmt = "0.00%";
  ws.columns.forEach((c, i) => {
    c.width = [14, 10, 10, 40, 18, 26, 14, 8, 14, 14, 14, 12][i];
  });

  // -------------------------------------------------- aba Por destinatário
  const wd = wb.addWorksheet("Por destinatário");
  wd.addRow(["Destinatário", "Papéis", "Negócios", "Devido", "Pago", "Pendente"]);
  [...porDestinatario.values()]
    .sort((a, b) => (b.devido - b.pago) - (a.devido - a.pago) || a.nome.localeCompare(b.nome))
    .forEach((d) => {
      wd.addRow([d.nome, [...d.papeis].join(", "), d.negocios, d.devido, d.pago, d.devido - d.pago]);
    });
  wd.getRow(1).font = { bold: true };
  wd.views = [{ state: "frozen", ySplit: 1 }];
  for (const c of [4, 5, 6]) wd.getColumn(c).numFmt = DINHEIRO;
  wd.columns.forEach((c, i) => { c.width = [28, 26, 10, 16, 16, 16][i]; });

  const buffer = await wb.xlsx.writeBuffer();
  // Fatia a string em vez de `new Date(...)`: "2026-09-01" é lido como
  // meia-noite UTC, que no fuso do Brasil é 31/08 às 21h — o arquivo de
  // setembro saía chamado "comissoes_2026-08.xlsx".
  const comp = de.slice(0, 7) === ate.slice(0, 7) ? de.slice(0, 7) : `${de.slice(0, 7)}_a_${ate.slice(0, 7)}`;
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comissoes_${comp}.xlsx"`,
    },
  });
}
