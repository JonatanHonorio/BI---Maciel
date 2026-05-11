"use client";
import { useState } from "react";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import LineChartCard from "@/components/charts/LineChartCard";
import {
  DollarSign, Eye, MousePointerClick, MonitorSmartphone, Users,
  TrendingUp, Megaphone, Image,
} from "lucide-react";

interface Resumo {
  investimento: number; impressoes: number; cliques: number;
  alcance: number; leads: number; conversas: number;
  link_clicks: number; video_views: number; lp_views: number;
  cpm: number; cpc: number; ctr: number; cpl: number;
}

interface Campanha {
  campanha: string; status: string; objetivo: string;
  investimento: number; impressoes: number; cliques: number;
  leads: number; conversas: number; link_clicks: number;
  lp_views: number; ctr: number; cpc: number; cpl: number;
}

interface Criativo {
  criativo: string; tipo_criativo: string; thumbnail_url: string | null;
  investimento: number; impressoes: number; cliques: number;
  leads: number; conversas: number; link_clicks: number;
  lp_views: number; video_views: number; ctr: number; cpl: number;
  connect_rate: number;
  video_p25: number; video_p50: number; video_p75: number; video_p100: number;
}

interface TData {
  resumo: Resumo;
  total_invest: number;
  por_campanha: Campanha[];
  por_criativo: Criativo[];
  por_dia: { dia: string; gasto: number; impressoes: number; cliques: number; leads: number }[];
  gasto_acumulado: { dia: string; acumulado: number }[];
}

function Semaforo({ value, metaOk, metaAtencao, invert }: { value: number; metaOk: number; metaAtencao: number; invert?: boolean }) {
  let color = "bg-gray-300";
  if (value > 0) {
    if (invert) {
      color = value <= metaOk ? "bg-green-500" : value <= metaAtencao ? "bg-yellow-400" : "bg-red-500";
    } else {
      color = value >= metaOk ? "bg-green-500" : value >= metaAtencao ? "bg-yellow-400" : "bg-red-500";
    }
  }
  return <span className={`inline-block w-3 h-3 rounded-full ${color} flex-shrink-0`} />;
}

function CampanhaTable({ data, totalInvest, search }: { data: Campanha[]; totalInvest: number; search: string }) {
  const filtered = data.filter(c => c.campanha.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-gray-500 uppercase">
            <th className="text-left py-3 px-2 min-w-[250px]">Campanha</th>
            <th className="text-right px-2">Invest</th>
            <th className="text-right px-2">% Invest</th>
            <th className="text-right px-2">Impr.</th>
            <th className="text-right px-2">Cliques</th>
            <th className="text-right px-2">CTR</th>
            <th className="text-right px-2">LP Views</th>
            <th className="text-right px-2">Leads</th>
            <th className="text-right px-2">CPL</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c, i) => {
            const pctInvest = totalInvest > 0 ? (Number(c.investimento) / totalInvest) * 100 : 0;
            return (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-2">
                  <div className="flex items-center gap-2">
                    <Semaforo value={Number(c.cpl)} metaOk={50} metaAtencao={100} invert />
                    <span className="truncate max-w-[320px]" title={c.campanha}>{c.campanha}</span>
                  </div>
                </td>
                <td className="text-right px-2 font-medium">{fmtMoney(Number(c.investimento))}</td>
                <td className="text-right px-2">{pctInvest.toFixed(1)}%</td>
                <td className="text-right px-2">{fmtNum(Number(c.impressoes))}</td>
                <td className="text-right px-2">{fmtNum(Number(c.cliques))}</td>
                <td className="text-right px-2">
                  <span className="flex items-center justify-end gap-1">
                    <Semaforo value={Number(c.ctr)} metaOk={1.0} metaAtencao={0.5} />
                    {Number(c.ctr).toFixed(1)}%
                  </span>
                </td>
                <td className="text-right px-2">{fmtNum(Number(c.lp_views))}</td>
                <td className="text-right px-2 font-semibold">{fmtNum(Number(c.leads))}</td>
                <td className="text-right px-2">
                  <span className="flex items-center justify-end gap-1">
                    <Semaforo value={Number(c.cpl)} metaOk={50} metaAtencao={100} invert />
                    {Number(c.cpl) > 0 ? fmtMoney(Number(c.cpl)) : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-gray-400">{filtered.length} registros</span>
        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Dentro da meta</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Atencao (ate 1,5x)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Fora da meta</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" /> Sem dados</span>
        </div>
      </div>
    </div>
  );
}

function CriativoTable({ data, search }: { data: Criativo[]; search: string }) {
  const filtered = data.filter(c => c.criativo.toLowerCase().includes(search.toLowerCase()));
  const [page, setPage] = useState(0);
  const perPage = 15;
  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice(page * perPage, (page + 1) * perPage);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-gray-500 uppercase">
            <th className="text-left py-3 px-2 min-w-[280px]">Criativo</th>
            <th className="text-right px-2">Invest</th>
            <th className="text-right px-2">Impr.</th>
            <th className="text-right px-2">Cliques</th>
            <th className="text-right px-2">CTR</th>
            <th className="text-right px-2">LP Views</th>
            <th className="text-right px-2">Connect</th>
            <th className="text-right px-2">Leads</th>
            <th className="text-right px-2">CPL</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((c, i) => (
            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <Semaforo value={Number(c.cpl)} metaOk={50} metaAtencao={100} invert />
                  {c.thumbnail_url && (
                    <img src={c.thumbnail_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                  )}
                  <span className="truncate max-w-[250px]" title={c.criativo}>{c.criativo}</span>
                </div>
              </td>
              <td className="text-right px-2 font-medium">{fmtMoney(Number(c.investimento))}</td>
              <td className="text-right px-2">{fmtNum(Number(c.impressoes))}</td>
              <td className="text-right px-2">{fmtNum(Number(c.cliques))}</td>
              <td className="text-right px-2">
                <span className="flex items-center justify-end gap-1">
                  <Semaforo value={Number(c.ctr)} metaOk={1.0} metaAtencao={0.5} />
                  {Number(c.ctr).toFixed(1)}%
                </span>
              </td>
              <td className="text-right px-2">{fmtNum(Number(c.lp_views))}</td>
              <td className="text-right px-2">
                <span className="flex items-center justify-end gap-1">
                  <Semaforo value={Number(c.connect_rate)} metaOk={90} metaAtencao={70} />
                  {Number(c.connect_rate).toFixed(1)}%
                </span>
              </td>
              <td className="text-right px-2 font-semibold">{fmtNum(Number(c.leads))}</td>
              <td className="text-right px-2">
                <span className="flex items-center justify-end gap-1">
                  <Semaforo value={Number(c.cpl)} metaOk={50} metaAtencao={100} invert />
                  {Number(c.cpl) > 0 ? fmtMoney(Number(c.cpl)) : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between items-center mt-3">
        <span className="text-xs text-gray-400">{filtered.length} registros</span>
        {totalPages > 1 && (
          <div className="flex gap-2 text-xs">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-gray-50">Anterior</button>
            <span className="px-2 py-1">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-gray-50">Proximo</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrafegoPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<TData>(`/api/trafego?since=${since}&until=${until}`);
  const [tab, setTab] = useState<"campanhas" | "criativos">("campanhas");
  const [search, setSearch] = useState("");

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const r = data.resumo;
  const invest = Number(r.investimento);
  const impressoes = Number(r.impressoes);
  const cliques = Number(r.cliques);
  const lpViews = Number(r.lp_views);
  const leads = Number(r.leads);
  const cpm = Number(r.cpm);
  const ctr = Number(r.ctr);
  const cpl = leads > 0 ? invest / leads : 0;
  const connectRate = cliques > 0 ? (lpViews / cliques) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Trafego</h2>
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b pb-0">
        {(["campanhas", "criativos"] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setSearch(""); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "campanhas" ? "Campanhas" : "Criativos"}
          </button>
        ))}
      </div>

      {/* Visao Geral */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-yellow-500" /> Visao Geral do Trafego
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Investimento" value={fmtMoney(invest)} icon={DollarSign} iconColor="text-blue-500" subtitle={`${fmtMoney(cpm)} CPM`} compact />
          <KpiCard label="Impressoes" value={fmtNum(impressoes)} icon={Eye} iconColor="text-purple-500" compact />
          <KpiCard label="Cliques" value={fmtNum(cliques)} icon={MousePointerClick} iconColor="text-orange-500" subtitle={`${ctr.toFixed(1)}% CTR`} compact />
          <KpiCard label="LP Views" value={fmtNum(lpViews)} icon={MonitorSmartphone} iconColor="text-cyan-500" subtitle={`${connectRate.toFixed(1)}% Connect`} compact />
          <KpiCard label="Leads Traf." value={fmtNum(leads)} icon={Users} iconColor="text-green-500" subtitle={`${fmtMoney(cpl)} CPL`} compact />
          <KpiCard label="CPL" value={fmtMoney(cpl)} icon={Megaphone} iconColor="text-red-500" />
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            {tab === "campanhas" ? (
              <><Megaphone size={16} className="text-blue-500" /> Performance por Campanha</>
            ) : (
              <><Image size={16} className="text-purple-500" /> Performance por Criativo</>
            )}
          </h3>
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm w-48 focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
          />
        </div>
        {tab === "campanhas" ? (
          <CampanhaTable data={data.por_campanha} totalInvest={data.total_invest} search={search} />
        ) : (
          <CriativoTable data={data.por_criativo} search={search} />
        )}
      </div>

      {/* Grafico de investimento diario */}
      <LineChartCard
        title="Investimento Diario"
        data={data.por_dia.map(d => ({ dia: d.dia, gasto: Number(d.gasto), leads: Number(d.leads) }))}
        xKey="dia"
        lines={[
          { key: "gasto", color: "#3b82f6", label: "Gasto (R$)" },
          { key: "leads", color: "#10b981", label: "Leads" },
        ]}
        formatY={(v) => fmtMoney(v)}
      />
    </div>
  );
}
