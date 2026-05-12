"use client";
import { useState } from "react";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtNum, fmtDate } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import BarChartCard from "@/components/charts/BarChartCard";
import LineChartCard from "@/components/charts/LineChartCard";
import {
  CalendarCheck,
  Home,
  ShoppingCart,
  Users,
  Bot,
  Search,
} from "lucide-react";

interface Visita {
  id: number;
  nome: string;
  email: string;
  tipo_transacao: string;
  origem: string;
  data_visita: string;
  localizacao: string;
  corretor_nome: string;
  referencia_imovel: string;
  match_method: string;
}

interface LaisData {
  resumo: {
    total: number;
    com_corretor: number;
    vendas: number;
    alugueis: number;
  };
  visitas: Visita[];
  por_corretor: {
    corretor: string;
    total: number;
    vendas: number;
    alugueis: number;
  }[];
  por_mes: { mes: string; total: number; vendas: number; alugueis: number }[];
  por_origem: { origem: string; total: number }[];
  por_dia: { dia: string; total: number }[];
}

function TipoTag({ tipo }: { tipo: string }) {
  const isVenda = tipo === "Venda";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        isVenda
          ? "bg-emerald-100 text-emerald-700"
          : "bg-blue-100 text-blue-700"
      }`}
    >
      {isVenda ? "Venda" : "Aluguel"}
    </span>
  );
}

function formatMesLabel(mes: string) {
  const [year, month] = mes.split("-");
  const meses: Record<string, string> = {
    "01": "Jan",
    "02": "Fev",
    "03": "Mar",
    "04": "Abr",
    "05": "Mai",
    "06": "Jun",
    "07": "Jul",
    "08": "Ago",
    "09": "Set",
    "10": "Out",
    "11": "Nov",
    "12": "Dez",
  };
  return `${meses[month] || month}/${year}`;
}

export default function LaisPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<LaisData>(
    `/api/lais-visitas?since=${since}&until=${until}`
  );
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<string>("todos");
  const [page, setPage] = useState(0);
  const perPage = 15;

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const r = data.resumo;
  const total = Number(r.total);
  const comCorretor = Number(r.com_corretor);
  const vendas = Number(r.vendas);
  const alugueis = Number(r.alugueis);

  // Filter visitas
  const filtered = data.visitas.filter((v) => {
    if (filterTipo !== "todos" && v.tipo_transacao !== filterTipo) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        (v.nome || "").toLowerCase().includes(s) ||
        (v.corretor_nome || "").toLowerCase().includes(s) ||
        (v.localizacao || "").toLowerCase().includes(s) ||
        (v.referencia_imovel || "").toLowerCase().includes(s)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice(page * perPage, (page + 1) * perPage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot size={24} className="text-purple-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Visitas Agendadas - Lais
            </h2>
            <p className="text-xs text-gray-500">
              Pre-atendimento automatizado via portais online
            </p>
          </div>
        </div>
        <DateFilter
          since={since}
          until={until}
          onSinceChange={setSince}
          onUntilChange={setUntil}
          onPreset={setPreset}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Visitas"
          value={fmtNum(total)}
          icon={CalendarCheck}
          iconColor="text-purple-500"
          subtitle={`${comCorretor} com corretor identificado`}
        />
        <KpiCard
          label="Vendas"
          value={fmtNum(vendas)}
          icon={ShoppingCart}
          iconColor="text-emerald-500"
          subtitle={`${total > 0 ? ((vendas / total) * 100).toFixed(0) : 0}% do total`}
        />
        <KpiCard
          label="Alugueis"
          value={fmtNum(alugueis)}
          icon={Home}
          iconColor="text-blue-500"
          subtitle={`${total > 0 ? ((alugueis / total) * 100).toFixed(0) : 0}% do total`}
        />
        <KpiCard
          label="Corretores Ativos"
          value={fmtNum(
            data.por_corretor.filter((c) => c.corretor !== "Nao identificado")
              .length
          )}
          icon={Users}
          iconColor="text-orange-500"
          subtitle="Recebendo visitas"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Visitas por Corretor (Top 15)"
          data={data.por_corretor
            .filter((c) => c.corretor !== "Nao identificado")
            .slice(0, 15)
            .map((c) => ({
              ...c,
              total: Number(c.total),
              vendas: Number(c.vendas),
              alugueis: Number(c.alugueis),
            }))}
          xKey="corretor"
          bars={[
            { key: "vendas", color: "#10b981", label: "Venda" },
            { key: "alugueis", color: "#3b82f6", label: "Aluguel" },
          ]}
          layout="horizontal"
          stacked
        />
        <BarChartCard
          title="Visitas por Origem"
          data={data.por_origem.map((o) => ({
            ...o,
            total: Number(o.total),
          }))}
          xKey="origem"
          bars={[{ key: "total", color: "#8b5cf6", label: "Visitas" }]}
          layout="horizontal"
        />
      </div>

      {data.por_dia.length > 1 && (
        <LineChartCard
          title="Visitas por Dia"
          data={data.por_dia.map((d) => ({
            dia: d.dia,
            total: Number(d.total),
          }))}
          xKey="dia"
          lines={[{ key: "total", color: "#8b5cf6", label: "Visitas" }]}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <CalendarCheck size={16} className="text-purple-500" />
            Detalhamento das Visitas
          </h3>
          <div className="flex items-center gap-3">
            <select
              value={filterTipo}
              onChange={(e) => {
                setFilterTipo(e.target.value);
                setPage(0);
              }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
            >
              <option value="todos">Todos</option>
              <option value="Venda">Venda</option>
              <option value="Aluguel">Aluguel</option>
            </select>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Buscar lead, corretor..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg w-56 focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase">
                  Lead
                </th>
                <th className="text-left px-2 text-xs font-semibold text-gray-500 uppercase">
                  Operacao
                </th>
                <th className="text-left px-2 text-xs font-semibold text-gray-500 uppercase">
                  Corretor
                </th>
                <th className="text-left px-2 text-xs font-semibold text-gray-500 uppercase">
                  Ref. Imovel
                </th>
                <th className="text-left px-2 text-xs font-semibold text-gray-500 uppercase">
                  Localizacao
                </th>
                <th className="text-left px-2 text-xs font-semibold text-gray-500 uppercase">
                  Origem
                </th>
                <th className="text-right px-2 text-xs font-semibold text-gray-500 uppercase">
                  Data Visita
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="py-2.5 px-2">
                    <div>
                      <span className="font-medium text-gray-900">
                        {v.nome}
                      </span>
                      {v.email && (
                        <p className="text-xs text-gray-400">{v.email}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-2">
                    <TipoTag tipo={v.tipo_transacao} />
                  </td>
                  <td className="px-2">
                    {v.corretor_nome ? (
                      <span className="text-gray-800">{v.corretor_nome}</span>
                    ) : (
                      <span className="text-gray-300 italic">
                        Nao identificado
                      </span>
                    )}
                  </td>
                  <td className="px-2">
                    {v.referencia_imovel ? (
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                        {v.referencia_imovel}
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-2">
                    <span
                      className="text-gray-600 truncate max-w-[180px] block"
                      title={v.localizacao}
                    >
                      {v.localizacao || "-"}
                    </span>
                  </td>
                  <td className="px-2">
                    <span className="text-xs text-gray-500">{v.origem}</span>
                  </td>
                  <td className="text-right px-2 text-gray-600">
                    {fmtDate(v.data_visita)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-400">
            {filtered.length} registros
          </span>
          {totalPages > 1 && (
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-gray-50"
              >
                Anterior
              </button>
              <span className="px-2 py-1">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-gray-50"
              >
                Proximo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
