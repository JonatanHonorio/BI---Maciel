"use client";
import { useMemo, useState } from "react";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtNum } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import DataTable from "@/components/DataTable";
import KpiCard from "@/components/KpiCard";
import { Users, Home, RefreshCw, ArrowLeftRight, AlertTriangle } from "lucide-react";

// `type` e não `interface`: o DataTable recebe `Record<string, unknown>[]`, e só
// o alias de tipo ganha a assinatura de índice implícita que satisfaz isso.
type Ranking = {
  id: number; nome: string; unidade: string;
  total: number; proprios?: number; outros?: number;
};
interface Movimento {
  id: number; nome: string; unidade: string; dia: string; total: number; proprios: number;
}
interface Dados {
  periodo: { since: string; until: string };
  dados_ate: string | null;
  resumo: {
    leads: number; captacoes: number; captacoes_cabecas: number;
    atualizacoes: number; atualizacoes_cabecas: number; campanha: number; remanejados: number;
    corretores_com_lead: number;
  };
  leads: Ranking[];
  captacoes: Ranking[];
  atualizacoes: Ranking[];
  campanha: Movimento[];
  remanejamentos: Movimento[];
}

const diaBR = (d: string) => d.split("-").reverse().join("/");

/** Linha de ranking já com a posição — calculada ANTES de qualquer filtro. */
type ComPosicao = Ranking & { pos: number };
const posicao = (lista: Ranking[]): ComPosicao[] => lista.map((r, i) => ({ ...r, pos: i + 1 }));

export default function ProdutividadePage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<Dados>(`/api/produtividade?since=${since}&until=${until}`);
  /*
   * Filtro por corretor (pedido da Lilian, 07/10/2026).
   *
   * Ela chama o corretor na mesa e mostra a tela com os números dele — e, do
   * jeito que estava, ele via os números de todo mundo junto. Não é falta de
   * permissão: ela pode ver a unidade inteira. É que a conversa é com UMA
   * pessoa, e o resto não deveria estar à vista.
   *
   * Por isso o filtro é da TELA, e não da consulta: o que muda é o que fica
   * visível, não o que ela tem direito de ver. E assim a POSIÇÃO no ranking
   * sobrevive ao filtro — é calculada sobre a lista inteira antes de filtrar.
   * Dizer "você é o 3º de 14" é metade do valor da conversa, e não entrega
   * nome nem número de ninguém.
   */
  const [corretorSel, setCorretorSel] = useState("");

  /** Todo mundo que aparece em qualquer um dos três rankings, uma vez só. */
  const corretores = useMemo(() => {
    const por = new Map<number, string>();
    for (const l of [data?.leads ?? [], data?.captacoes ?? [], data?.atualizacoes ?? []]) {
      for (const r of l) por.set(r.id, r.nome);
    }
    return [...por.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [data]);

  const id = Number(corretorSel) || null;

  /**
   * O que vai para a tela. Com corretor escolhido, cada bloco fica com a linha
   * dele — e os números do topo passam a ser os dele.
   *
   * Os KPIs de captação e atualização são "imóveis distintos" no geral, e por
   * isso não dá para somar linhas de ranking para obter o total. Para UMA
   * pessoa, porém, os dois números coincidem: um imóvel que ela captou conta
   * uma vez para ela, haja ou não um segundo captador. Por isso aqui pode sair
   * da própria linha.
   */
  const vista = useMemo(() => {
    const leads = posicao(data?.leads ?? []);
    const captacoes = posicao(data?.captacoes ?? []);
    const atualizacoes = posicao(data?.atualizacoes ?? []);
    if (!data) return null;
    if (!id) {
      return {
        leads, captacoes, atualizacoes,
        campanha: data.campanha, remanejamentos: data.remanejamentos,
        resumo: data.resumo, nome: null as string | null,
      };
    }
    const so = (l: ComPosicao[]) => l.filter((r) => r.id === id);
    const meusLeads = so(leads);
    const minhasCapt = so(captacoes);
    const minhasAtu = so(atualizacoes);
    const campanha = data.campanha.filter((m) => m.id === id);
    const remanejamentos = data.remanejamentos.filter((m) => m.id === id);
    const soma = (l: { total: number }[]) => l.reduce((s, x) => s + x.total, 0);
    return {
      leads: meusLeads, captacoes: minhasCapt, atualizacoes: minhasAtu,
      campanha, remanejamentos,
      resumo: {
        ...data.resumo,
        leads: soma(meusLeads),
        captacoes: soma(minhasCapt), captacoes_cabecas: soma(minhasCapt),
        atualizacoes: soma(minhasAtu), atualizacoes_cabecas: soma(minhasAtu),
        campanha: soma(campanha), remanejados: soma(remanejamentos),
        corretores_com_lead: meusLeads.length,
      },
      nome: corretores.find((c) => c.id === id)?.nome ?? null,
    };
  }, [data, id, corretores]);

  if (!data || !vista) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Produtividade por corretor</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={corretorSel}
            onChange={(e) => setCorretorSel(e.target.value)}
            className="border-input bg-card rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Todos os corretores</option>
            {corretores.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
          <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
        </div>
      </div>

      {/* Faixa azul porque a tela toda muda de significado: sem ela, alguém
          olhando de passagem lê os números de uma pessoa como os da unidade. */}
      {vista.nome && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <p className="text-sm text-blue-900">
            Mostrando só <strong>{vista.nome}</strong> — os números abaixo são dele.
          </p>
          <button
            onClick={() => setCorretorSel("")}
            className="text-xs font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            ver a equipe toda
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Leads recebidos" value={fmtNum(vista.resumo.leads)}
          subtitle={vista.nome ? "no período" : `${vista.resumo.corretores_com_lead} corretores`} icon={Users} />
        {/* Imóveis DISTINTOS. A soma da coluna do ranking é maior porque imóvel
            captado em dupla conta 1 para cada corretor — certo no ranking,
            errado como total. O subtítulo diz a diferença quando ela existe. */}
        <KpiCard label="Captações" value={fmtNum(vista.resumo.captacoes)}
          subtitle={vista.resumo.captacoes_cabecas > vista.resumo.captacoes
            ? `imóveis novos · ${vista.resumo.captacoes_cabecas} c/ captação em dupla`
            : "imóveis novos no período"} icon={Home} />
        <KpiCard label="Imóveis atualizados" value={fmtNum(vista.resumo.atualizacoes)}
          subtitle={vista.resumo.atualizacoes_cabecas > vista.resumo.atualizacoes
            ? `imóveis distintos · ${vista.resumo.atualizacoes_cabecas} participações`
            : "imóveis distintos no período"} icon={RefreshCw} />
        <KpiCard label="Captação por atualização" value={fmtNum(vista.resumo.campanha)}
          subtitle="o próprio corretor atualizou" icon={ArrowLeftRight} />
      </div>

      {/*
        O aviso fica ACIMA dos rankings de propósito: remanejamento de carteira
        não é produção, e ver o número antes das tabelas evita que alguém leia o
        ranking sem saber que houve movimentação de imóveis no período.
      */}
      {vista.remanejamentos.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
            <AlertTriangle size={16} /> Remanejamento de carteira — {fmtNum(vista.resumo.remanejados)} imóveis
          </h3>
          <p className="text-xs text-amber-800 mb-3">
            Captador novo em imóvel antigo, atualizado por outra pessoa. <strong>Não conta como captação</strong> —
            aparece aqui só para você saber que aconteceu.
          </p>
          <div className="space-y-1">
            {vista.remanejamentos.slice(0, 8).map((m, i) => (
              <div key={i} className="text-xs text-amber-900 flex gap-3">
                <span className="tabular-nums text-amber-700">{diaBR(m.dia)}</span>
                <span className="font-semibold tabular-nums w-10 text-right">{m.total}</span>
                <span>{m.nome}</span>
                <span className="text-amber-600">{m.unidade}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Users size={16} /> Leads recebidos
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Contados pela <strong>data em que o lead foi atribuído</strong> ao corretor, não pela abertura da ordem.
          </p>
          <DataTable
            columns={[
              { key: "pos", label: "#", align: "center", format: (v) => String(v) },
              { key: "nome", label: "Corretor" },
              { key: "unidade", label: "Unidade" },
              { key: "total", label: "Leads", align: "right", format: (v) => fmtNum(v as number) },
            ]}
            data={vista.leads}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Home size={16} /> Captações
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Só imóveis <strong>cadastrados no período</strong>. Imóvel em dupla conta 1 para cada captador,
            então a soma da coluna pode passar o total de imóveis.
          </p>
          <DataTable
            columns={[
              { key: "pos", label: "#", align: "center", format: (v) => String(v) },
              { key: "nome", label: "Corretor" },
              { key: "unidade", label: "Unidade" },
              { key: "total", label: "Captações", align: "right", format: (v) => fmtNum(v as number) },
            ]}
            data={vista.captacoes}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <RefreshCw size={16} /> Imóveis atualizados
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          <strong>Própria carteira</strong> é o corretor mantendo os imóveis dele em dia.{" "}
          <strong>De outros</strong> é imóvel de terceiro — é aí que a campanha “atualizou, ganha a captação” aparece.
        </p>
        <DataTable
          columns={[
            { key: "pos", label: "#", align: "center", format: (v) => String(v) },
            { key: "nome", label: "Corretor" },
            { key: "unidade", label: "Unidade" },
            { key: "total", label: "Total", align: "right", format: (v) => fmtNum(v as number) },
            { key: "proprios", label: "Própria carteira", align: "right", format: (v) => fmtNum(v as number) },
            { key: "outros", label: "De outros", align: "right", format: (v) => fmtNum(v as number) },
          ]}
          data={vista.atualizacoes}
        />
      </div>

      <p className="text-xs text-gray-400">
        Dados do Kurole até {data.dados_ate ? new Date(data.dados_ate).toLocaleString("pt-BR") : "—"}.
        Vendas ficam fora deste painel: o registro de venda no Kurole ainda não é hábito da equipe,
        então o número mediria adesão ao sistema e não produção.
      </p>
    </div>
  );
}
