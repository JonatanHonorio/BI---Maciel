"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtNum } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import DataTable from "@/components/DataTable";
import KpiCard from "@/components/KpiCard";
import { Users, Home, RefreshCw, ArrowLeftRight, AlertTriangle } from "lucide-react";

interface Ranking {
  id: number; nome: string; unidade: string;
  total: number; proprios?: number; outros?: number;
}
interface Movimento {
  nome: string; unidade: string; dia: string; total: number; proprios: number;
}
interface Dados {
  periodo: { since: string; until: string };
  dados_ate: string | null;
  resumo: {
    leads: number; captacoes: number; captacoes_cabecas: number;
    atualizacoes: number; campanha: number; remanejados: number;
    corretores_com_lead: number;
  };
  leads: Ranking[];
  captacoes: Ranking[];
  atualizacoes: Ranking[];
  campanha: Movimento[];
  remanejamentos: Movimento[];
}

const diaBR = (d: string) => d.split("-").reverse().join("/");

export default function ProdutividadePage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<Dados>(`/api/produtividade?since=${since}&until=${until}`);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const posicao = (lista: Ranking[]) => lista.map((r, i) => ({ ...r, pos: i + 1 }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Produtividade por corretor</h2>
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Leads recebidos" value={fmtNum(data.resumo.leads)}
          subtitle={`${data.resumo.corretores_com_lead} corretores`} icon={Users} />
        {/* Imóveis DISTINTOS. A soma da coluna do ranking é maior porque imóvel
            captado em dupla conta 1 para cada corretor — certo no ranking,
            errado como total. O subtítulo diz a diferença quando ela existe. */}
        <KpiCard label="Captações" value={fmtNum(data.resumo.captacoes)}
          subtitle={data.resumo.captacoes_cabecas > data.resumo.captacoes
            ? `imóveis novos · ${data.resumo.captacoes_cabecas} c/ captação em dupla`
            : "imóveis novos no período"} icon={Home} />
        <KpiCard label="Imóveis atualizados" value={fmtNum(data.resumo.atualizacoes)} icon={RefreshCw} />
        <KpiCard label="Captação por atualização" value={fmtNum(data.resumo.campanha)}
          subtitle="o próprio corretor atualizou" icon={ArrowLeftRight} />
      </div>

      {/*
        O aviso fica ACIMA dos rankings de propósito: remanejamento de carteira
        não é produção, e ver o número antes das tabelas evita que alguém leia o
        ranking sem saber que houve movimentação de imóveis no período.
      */}
      {data.remanejamentos.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
            <AlertTriangle size={16} /> Remanejamento de carteira — {fmtNum(data.resumo.remanejados)} imóveis
          </h3>
          <p className="text-xs text-amber-800 mb-3">
            Captador novo em imóvel antigo, atualizado por outra pessoa. <strong>Não conta como captação</strong> —
            aparece aqui só para você saber que aconteceu.
          </p>
          <div className="space-y-1">
            {data.remanejamentos.slice(0, 8).map((m, i) => (
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
            data={posicao(data.leads)}
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
            data={posicao(data.captacoes)}
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
          data={posicao(data.atualizacoes)}
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
