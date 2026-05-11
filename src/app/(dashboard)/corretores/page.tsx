"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import DataTable from "@/components/DataTable";
import BarChartCard from "@/components/charts/BarChartCard";
import { Users } from "lucide-react";

interface CorretoresData {
  ranking: {
    id: number; nome: string; nome_comercial: string;
    leads: number; propostas: number; conversoes: number;
    receita: number; taxa_conversao: number;
  }[];
  tempo_resposta: { nome: string; tempo_medio_min: number }[];
}

export default function CorretoresPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<CorretoresData>(`/api/corretores?since=${since}&until=${until}`);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Corretores</h2>
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Users size={16} /> Ranking de Corretores
        </h3>
        <DataTable
          columns={[
            { key: "pos", label: "#", align: "center", format: (v) => String(v) },
            { key: "nome", label: "Corretor" },
            { key: "leads", label: "Leads", align: "right", format: (v) => fmtNum(v as number) },
            { key: "propostas", label: "Propostas", align: "right", format: (v) => fmtNum(v as number) },
            { key: "conversoes", label: "Conversões", align: "right", format: (v) => fmtNum(v as number) },
            { key: "receita", label: "Receita", align: "right", format: (v) => fmtMoney(v as number) },
            { key: "taxa_conversao", label: "Conversão", align: "right", format: (v) => fmtPct(v as number) },
          ]}
          data={data.ranking.map((r, i) => ({ ...r, pos: i + 1 }))}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Conversões por Corretor"
          data={data.ranking.filter((r) => r.conversoes > 0).slice(0, 10)}
          xKey="nome"
          bars={[{ key: "conversoes", color: "#10b981", label: "Conversões" }]}
          layout="horizontal"
        />
        <BarChartCard
          title="Tempo Médio de Resposta (min)"
          data={data.tempo_resposta.slice(0, 10).map((t) => ({
            ...t,
            tempo_medio_min: Math.round(Number(t.tempo_medio_min)),
          }))}
          xKey="nome"
          bars={[{ key: "tempo_medio_min", color: "#f59e0b", label: "Minutos" }]}
          layout="horizontal"
        />
      </div>
    </div>
  );
}
