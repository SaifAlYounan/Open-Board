import { useState, useEffect, useRef, useCallback } from "react";
import { SecretarySidebar } from "@/components/SecretarySidebar";
import {
  Network,
  Vote,
  Calendar,
  FileText,
  File,
  CheckSquare,
  User,
  Layers,
  X,
  ExternalLink,
  Loader2,
  Search,
  BarChart3,
  Users,
  AlertTriangle,
  Clock,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import * as d3 from "d3";

const API_BASE = "";

interface GraphNode {
  id: string;
  type: "board" | "person" | "vote" | "meeting" | "minutes" | "document" | "task";
  label: string;
  status?: string | null;
  date?: string | null;
  boardId?: string | null;
  role?: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

interface SimNode extends d3.SimulationNodeDatum, GraphNode {
  x: number;
  y: number;
  isMatch?: boolean;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relationship: string;
}

interface SummaryData {
  votes: { total: number; open: number; approved: number; rejected: number };
  meetings: { total: number; upcoming: number; past: number };
  documents: { total: number };
  tasks: { total: number; open: number; done: number; overdue: number };
  minutes: { total: number; signed: number; review: number; draft: number };
  people: { boardMembers: number };
  projects: ProjectData[];
  timeline: TimelineItem[];
}

interface ProjectData {
  name: string;
  subtitle: string;
  status: string;
  statusIcon: string;
  searchTerm: string;
  votes: { total: number; approved: number };
  meetings: number;
  documents: number;
  tasks: { total: number; open: number; done: number; overdue: number };
  latest: { title: string; date: string | null } | null;
}

interface TimelineItem {
  id: string;
  title: string;
  status: string;
  date: string | null;
  board: string;
  resolutionNumber: string | null;
}

interface SearchResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  matches: GraphNode[];
  summary: string;
}

const NODE_COLORS: Record<string, string> = {
  board: "#D4A017",
  person: "#8B5CF6",
  vote: "#3B82F6",
  meeting: "#10B981",
  minutes: "#14B8A6",
  document: "#F59E0B",
  task: "#EF4444",
};

const TYPE_ICONS: Record<string, typeof Vote> = {
  vote: Vote,
  meeting: Calendar,
  minutes: FileText,
  document: File,
  task: CheckSquare,
  person: User,
  board: Layers,
};

function getNodeLink(node: GraphNode): string | null {
  switch (node.type) {
    case "vote": return `/secretary/votes/${node.id}`;
    case "meeting": return `/secretary/meetings/${node.id}`;
    case "minutes": return `/secretary/minutes/${node.id}`;
    case "task": return `/secretary/tasks/${node.id}`;
    case "document": return `/secretary/documents`;
    default: return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-blue-100 text-blue-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    cancelled: "bg-gray-100 text-gray-500",
    lapsed: "bg-gray-100 text-gray-500",
    scheduled: "bg-blue-100 text-blue-700",
    concluded: "bg-green-100 text-green-700",
    draft: "bg-yellow-100 text-yellow-700",
    review: "bg-orange-100 text-orange-700",
    signing: "bg-purple-100 text-purple-700",
    signed: "bg-green-100 text-green-700",
    todo: "bg-blue-100 text-blue-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    done: "bg-green-100 text-green-700",
    blocked: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || "bg-gray-100 text-gray-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatCard({ icon: Icon, iconColor, title, total, lines }: {
  icon: typeof Vote;
  iconColor: string;
  title: string;
  total: number;
  lines: { label: string; value: number; color?: string }[];
}) {
  return (
    <div className="bg-white rounded-xl border border-[#e5e5e7] p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: iconColor + "15" }}>
          <Icon size={16} style={{ color: iconColor }} />
        </div>
        <div className="text-sm font-medium text-[#86868b]">{title}</div>
      </div>
      <div className="text-2xl font-semibold text-[#1d1d1f] mb-2">{total}</div>
      <div className="space-y-1">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-[#86868b]">{l.label}</span>
            <span className={l.color || "text-[#1d1d1f]"} style={{ fontWeight: 500 }}>{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, onViewTrail }: { project: ProjectData; onViewTrail: (term: string) => void }) {
  const statusColors: Record<string, string> = {
    warning: "text-amber-600 bg-amber-50",
    yellow: "text-yellow-600 bg-yellow-50",
    wrench: "text-blue-600 bg-blue-50",
  };
  const statusIcons: Record<string, string> = {
    warning: "⚠️",
    yellow: "🟡",
    wrench: "🔧",
  };

  return (
    <div className="bg-white rounded-xl border border-[#e5e5e7] p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1d1d1f]">{project.name}</h3>
          <p className="text-xs text-[#86868b]">{project.subtitle}</p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[project.statusIcon] || "text-gray-600 bg-gray-50"}`}>
          {statusIcons[project.statusIcon] || "📋"} {project.status}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-[#86868b] mb-3 flex-wrap">
        <span className="flex items-center gap-1">
          <Calendar size={12} className="text-emerald-500" />
          {project.meetings} meetings
        </span>
        <ArrowRight size={10} className="text-[#d2d2d7]" />
        <span className="flex items-center gap-1">
          <Vote size={12} className="text-blue-500" />
          {project.votes.total} votes ({project.votes.approved} approved)
        </span>
        <ArrowRight size={10} className="text-[#d2d2d7]" />
        <span className="flex items-center gap-1">
          <File size={12} className="text-amber-500" />
          {project.documents} docs
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-[#86868b] mb-3">
        <CheckSquare size={12} className="text-red-500" />
        <span>{project.tasks.total} tasks ({project.tasks.done} done, {project.tasks.open} open)</span>
        {project.tasks.overdue > 0 && (
          <span className="text-red-600 font-medium flex items-center gap-1">
            <AlertTriangle size={11} />
            {project.tasks.overdue} overdue
          </span>
        )}
      </div>

      {project.latest && (
        <div className="text-xs text-[#1d1d1f] mb-3 bg-[#f5f5f7] rounded-lg px-3 py-2">
          <span className="text-[#86868b]">Latest:</span>{" "}
          {project.latest.title}
          {project.latest.date && <span className="text-[#86868b]"> ({formatDate(project.latest.date)})</span>}
        </div>
      )}

      <button
        onClick={() => onViewTrail(project.searchTerm)}
        className="text-xs text-[#0071e3] font-medium hover:underline flex items-center gap-1 mt-1"
      >
        View Trail <ChevronRight size={12} />
      </button>
    </div>
  );
}

function DecisionTimeline({ timeline, onSelectVote }: { timeline: TimelineItem[]; onSelectVote: (id: string) => void }) {
  if (timeline.length === 0) return null;

  const months = new Map<string, TimelineItem[]>();
  for (const item of timeline) {
    if (!item.date) continue;
    const d = new Date(item.date);
    const key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(item);
  }

  const statusColor: Record<string, string> = {
    approved: "#22c55e",
    rejected: "#ef4444",
    open: "#eab308",
  };

  return (
    <div className="bg-white rounded-xl border border-[#e5e5e7] p-5">
      <h3 className="text-sm font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
        <Clock size={14} className="text-[#0071e3]" />
        Decision Timeline
      </h3>
      <div className="overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {[...months.entries()].map(([month, items], mi) => (
            <div key={month} className="flex flex-col items-start min-w-[140px]">
              <div className="text-xs font-medium text-[#86868b] mb-3 px-1">{month}</div>
              <div className="relative w-full">
                <div className="absolute top-[5px] left-0 right-0 h-[2px] bg-[#e5e5e7]" />
                <div className="flex flex-col gap-2 relative">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onSelectVote(item.id)}
                      className="flex items-start gap-2 text-left group pl-1"
                    >
                      <div
                        className="w-[10px] h-[10px] rounded-full flex-shrink-0 mt-0.5 ring-2 ring-white"
                        style={{ backgroundColor: statusColor[item.status || ""] || "#9ca3af" }}
                      />
                      <div className="leading-tight">
                        <div className="text-[11px] text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors line-clamp-2">
                          {item.title.length > 35 ? item.title.slice(0, 35) + "…" : item.title}
                        </div>
                        <div className="text-[10px] text-[#86868b]">{item.board}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickFilters({ onSearch, activeQuery }: { onSearch: (q: string) => void; activeQuery: string }) {
  const filters = [
    { label: "Project Zephyr", query: "zephyr" },
    { label: "Project Aurora", query: "aurora" },
    { label: "ESG & Compliance", query: "ESG" },
    { label: "Open Votes", query: "open" },
    { label: "Overdue Tasks", query: "overdue" },
    { label: "Recent Decisions", query: "recent" },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[#86868b]">Quick filters:</span>
      {filters.map((f) => (
        <button
          key={f.query}
          onClick={() => onSearch(activeQuery === f.query ? "" : f.query)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
            activeQuery === f.query
              ? "bg-[#0071e3] text-white border-[#0071e3]"
              : "bg-white text-[#1d1d1f] border-[#d2d2d7] hover:border-[#0071e3] hover:text-[#0071e3]"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function ResultsPanel({ matches, onSelect, selectedId }: {
  matches: GraphNode[];
  onSelect: (node: GraphNode) => void;
  selectedId: string | null;
}) {
  const grouped = matches.reduce((acc, m) => {
    if (!acc[m.type]) acc[m.type] = [];
    acc[m.type].push(m);
    return acc;
  }, {} as Record<string, GraphNode[]>);

  const typeOrder = ["vote", "meeting", "document", "task", "minutes", "person"];

  return (
    <div className="border-t border-[#e5e5e7] bg-white p-4 overflow-x-auto">
      <div className="space-y-4">
        {typeOrder.filter((t) => grouped[t]?.length).map((type) => {
          const Icon = TYPE_ICONS[type] || Layers;
          const color = NODE_COLORS[type];
          return (
            <div key={type}>
              <div className="text-xs font-medium text-[#86868b] mb-2 capitalize flex items-center gap-1.5">
                <Icon size={12} style={{ color }} />
                {type === "minutes" ? "Minutes" : type + "s"} ({grouped[type].length})
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {grouped[type].map((node) => (
                  <button
                    key={node.id}
                    onClick={() => onSelect(node)}
                    className={`flex-shrink-0 text-left p-3 rounded-lg border transition-all min-w-[200px] max-w-[280px] ${
                      selectedId === node.id
                        ? "border-[#0071e3] bg-blue-50/50 shadow-sm"
                        : "border-[#e5e5e7] bg-white hover:border-[#0071e3]/40"
                    }`}
                    style={{ borderLeftWidth: 3, borderLeftColor: color }}
                  >
                    <div className="text-xs font-medium text-[#1d1d1f] line-clamp-2 mb-1">{node.label}</div>
                    <div className="flex items-center gap-2">
                      {node.status && <StatusBadge status={node.status} />}
                      {node.date && <span className="text-[10px] text-[#86868b]">{formatDate(node.date)}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailSidebar({ node, edges, allNodes, onSelectNode, onClose }: {
  node: GraphNode;
  edges: (GraphEdge & { otherNode: GraphNode })[];
  allNodes: GraphNode[];
  onSelectNode: (n: GraphNode) => void;
  onClose: () => void;
}) {
  const Icon = TYPE_ICONS[node.type] || Layers;
  const color = NODE_COLORS[node.type];
  const link = getNodeLink(node);

  return (
    <div className="w-80 bg-white border-l border-[#e5e5e7] overflow-y-auto flex-shrink-0">
      <div className="p-5 border-b border-[#e5e5e7] flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color + "15" }}>
            <Icon size={16} style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-[#86868b] uppercase tracking-wide">{node.type}</div>
            <div className="text-sm font-semibold text-[#1d1d1f] leading-tight">{node.label}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] p-1 rounded-lg hover:bg-[#f5f5f7] transition-colors flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {node.status && (
          <div>
            <div className="text-[10px] font-medium text-[#86868b] uppercase tracking-wide mb-1">Status</div>
            <StatusBadge status={node.status} />
          </div>
        )}
        {node.date && (
          <div>
            <div className="text-[10px] font-medium text-[#86868b] uppercase tracking-wide mb-1">Date</div>
            <div className="text-sm text-[#1d1d1f]">{formatDate(node.date)}</div>
          </div>
        )}
        {node.role && (
          <div>
            <div className="text-[10px] font-medium text-[#86868b] uppercase tracking-wide mb-1">Role</div>
            <div className="text-sm text-[#1d1d1f] capitalize">{node.role}</div>
          </div>
        )}

        {link && (
          <Link href={link}>
            <div className="flex items-center gap-2 text-sm text-[#0071e3] font-medium hover:underline cursor-pointer py-1">
              <ExternalLink size={14} />
              Open {node.type} page
            </div>
          </Link>
        )}

        <div>
          <div className="text-[10px] font-medium text-[#86868b] uppercase tracking-wide mb-2">
            Connected ({edges.length})
          </div>
          <div className="space-y-1">
            {edges.map((edge, i) => {
              const EIcon = TYPE_ICONS[edge.otherNode.type] || Layers;
              return (
                <button
                  key={i}
                  onClick={() => onSelectNode(edge.otherNode)}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#f5f5f7] text-left transition-colors"
                >
                  <EIcon size={14} style={{ color: NODE_COLORS[edge.otherNode.type] }} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#1d1d1f] truncate">{edge.otherNode.label}</div>
                    <div className="text-[10px] text-[#86868b]">{edge.relationship}</div>
                  </div>
                  {edge.otherNode.status && <StatusBadge status={edge.otherNode.status} />}
                </button>
              );
            })}
            {edges.length === 0 && (
              <div className="text-xs text-[#86868b] py-2">No connections</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FocusedGraph({ data, matchIds, onNodeClick, selectedNodeId }: {
  data: { nodes: GraphNode[]; edges: GraphEdge[] };
  matchIds: Set<string>;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;
    if (data.nodes.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 20).attr("refY", 5)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path").attr("d", "M 0 0 L 10 5 L 0 10 z").attr("fill", "#d1d5db");

    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const simNodes: SimNode[] = data.nodes.map((n) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 300,
      y: height / 2 + (Math.random() - 0.5) * 300,
      isMatch: matchIds.has(n.id),
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = data.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)!, relationship: e.relationship }));

    const simulation = d3.forceSimulation(simNodes)
      .force("link", d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => (d.isMatch ? 18 : 12) + 4));
    simulationRef.current = simulation;

    const linkGroup = g.append("g");
    const link = linkGroup.selectAll("line").data(simLinks).join("line")
      .attr("stroke", "#d1d5db")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1)
      .attr("marker-end", "url(#arrow)");

    const linkLabels = linkGroup.selectAll("text").data(simLinks).join("text")
      .text((d) => d.relationship)
      .attr("font-size", "8px")
      .attr("fill", "#9ca3af")
      .attr("text-anchor", "middle")
      .attr("opacity", 0)
      .attr("pointer-events", "none");

    const nodeGroup = g.append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }),
      );

    nodeGroup.append("circle")
      .attr("r", (d) => d.isMatch ? 16 : 10)
      .attr("fill", (d) => NODE_COLORS[d.type])
      .attr("fill-opacity", (d) => d.isMatch ? 1 : 0.5)
      .attr("stroke", (d) => d.id === selectedNodeId ? "#0071e3" : "#fff")
      .attr("stroke-width", (d) => d.id === selectedNodeId ? 3 : 2);

    nodeGroup.append("text")
      .text((d) => {
        if (!d.isMatch) return "";
        const maxLen = d.type === "board" ? 8 : 18;
        return d.label.length > maxLen ? d.label.slice(0, maxLen) + "…" : d.label;
      })
      .attr("text-anchor", "middle")
      .attr("dy", (d) => (d.isMatch ? 16 : 10) + 14)
      .attr("font-size", "10px")
      .attr("fill", "#4B5563")
      .attr("pointer-events", "none");

    nodeGroup.on("click", (_event, d) => onNodeClick(d));

    nodeGroup.on("mouseover", function (_event, d) {
      const connectedIds = new Set<string>([d.id]);
      simLinks.forEach((l) => {
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        if (src === d.id) connectedIds.add(tgt);
        if (tgt === d.id) connectedIds.add(src);
      });
      nodeGroup.attr("opacity", (n) => connectedIds.has(n.id) ? 1 : 0.15);
      link.attr("stroke-opacity", (l) => {
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return src === d.id || tgt === d.id ? 0.8 : 0.05;
      });
      linkLabels.attr("opacity", (l) => {
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return src === d.id || tgt === d.id ? 1 : 0;
      });

      const tooltip = g.append("g").attr("class", "tooltip-group");
      tooltip.append("rect")
        .attr("x", d.x - 60).attr("y", d.y - (d.isMatch ? 16 : 10) - 28)
        .attr("width", 120).attr("height", 20).attr("rx", 4)
        .attr("fill", "#1d1d1f").attr("opacity", 0.9);
      tooltip.append("text")
        .attr("x", d.x).attr("y", d.y - (d.isMatch ? 16 : 10) - 14)
        .attr("text-anchor", "middle").attr("fill", "#fff").attr("font-size", "9px")
        .text(d.label.length > 24 ? d.label.slice(0, 24) + "…" : d.label);
    });

    nodeGroup.on("mouseout", () => {
      nodeGroup.attr("opacity", 1);
      link.attr("stroke-opacity", 0.6);
      linkLabels.attr("opacity", 0);
      g.selectAll(".tooltip-group").remove();
    });

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x)
        .attr("y1", (d) => (d.source as SimNode).y)
        .attr("x2", (d) => (d.target as SimNode).x)
        .attr("y2", (d) => (d.target as SimNode).y);
      linkLabels
        .attr("x", (d) => ((d.source as SimNode).x + (d.target as SimNode).x) / 2)
        .attr("y", (d) => ((d.source as SimNode).y + (d.target as SimNode).y) / 2);
      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    setTimeout(() => {
      const bounds = g.node()?.getBBox();
      if (bounds) {
        const padding = 40;
        const scale = Math.min(
          width / (bounds.width + padding * 2),
          height / (bounds.height + padding * 2),
          1.5,
        );
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        const transform = d3.zoomIdentity
          .translate(width / 2 - cx * scale, height / 2 - cy * scale)
          .scale(scale);
        svg.transition().duration(600).call(zoom.transform, transform);
      }
    }, 1500);

    return () => { simulation.stop(); };
  }, [data, matchIds, onNodeClick, selectedNodeId]);

  return (
    <div ref={containerRef} className="flex-1 bg-[#f8f9fa] min-h-[350px] relative">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

export default function Intelligence() {
  const { user } = useAuth();
  const [boards, setBoards] = useState<{ id: string; name: string; abbreviation: string }[]>([]);
  const [filterBoardId, setFilterBoardId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [connectedEdges, setConnectedEdges] = useState<(GraphEdge & { otherNode: GraphNode })[]>([]);
  const [showFullGraph, setShowFullGraph] = useState(false);
  const [fullGraphData, setFullGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetch(`${API_BASE}/api/boards?limit=100`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBoards(data); });
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = filterBoardId
      ? `${API_BASE}/api/graph/summary?boardId=${filterBoardId}`
      : `${API_BASE}/api/graph/summary`;
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setSummaryData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filterBoardId]);

  const doSearch = useCallback((query: string) => {
    setActiveSearch(query);
    setSearchQuery(query);
    setSelectedNode(null);
    setShowFullGraph(false);
    if (!query.trim()) {
      setSearchResult(null);
      return;
    }
    setSearchLoading(true);
    const url = filterBoardId
      ? `${API_BASE}/api/graph/search?q=${encodeURIComponent(query)}&boardId=${filterBoardId}`
      : `${API_BASE}/api/graph/search?q=${encodeURIComponent(query)}`;
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setSearchResult(data); setSearchLoading(false); })
      .catch(() => setSearchLoading(false));
  }, [filterBoardId]);

  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim()) doSearch(value);
      else { setActiveSearch(""); setSearchResult(null); }
    }, 300);
  }, [doSearch]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    const data = searchResult || fullGraphData;
    if (!data) return;
    setSelectedNode(node);
    const related = data.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => {
        const otherId = e.source === node.id ? e.target : e.source;
        const otherNode = data.nodes.find((n) => n.id === otherId);
        return { ...e, otherNode: otherNode! };
      })
      .filter((e) => e.otherNode);
    setConnectedEdges(related);
  }, [searchResult, fullGraphData]);

  const handleShowFullGraph = useCallback(() => {
    setShowFullGraph(true);
    setActiveSearch("");
    setSearchQuery("");
    setSearchResult(null);
    const url = filterBoardId
      ? `${API_BASE}/api/graph?boardId=${filterBoardId}`
      : `${API_BASE}/api/graph`;
    setSearchLoading(true);
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setFullGraphData(data); setSearchLoading(false); })
      .catch(() => setSearchLoading(false));
  }, [filterBoardId]);

  const handleTimelineVoteClick = useCallback((voteId: string) => {
    const vote = summaryData?.timeline.find((t) => t.id === voteId);
    if (vote) {
      doSearch(vote.title.split("—")[0].trim().split(" ").slice(0, 3).join(" "));
    }
  }, [summaryData, doSearch]);

  const isSearchActive = !!activeSearch || !!searchResult;
  const graphData = searchResult || (showFullGraph ? fullGraphData : null);
  const matchIds = new Set(searchResult?.matches?.map((m) => m.id) || []);

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-hidden flex flex-col">
        <div className="px-8 py-5 border-b border-[#e5e5e7] bg-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#0071e3]/10 flex items-center justify-center">
                <Network size={18} className="text-[#0071e3]" />
              </div>
              <h1 className="text-xl font-semibold text-[#1d1d1f]">Board Intelligence</h1>
            </div>
            <div className="flex items-center gap-3">
              {(isSearchActive || showFullGraph) && (
                <button
                  onClick={() => {
                    setActiveSearch("");
                    setSearchQuery("");
                    setSearchResult(null);
                    setSelectedNode(null);
                    setShowFullGraph(false);
                    setFullGraphData(null);
                  }}
                  className="text-xs text-[#0071e3] font-medium hover:underline"
                >
                  ← Back to Dashboard
                </button>
              )}
              <select
                value={filterBoardId}
                onChange={(e) => {
                  setFilterBoardId(e.target.value);
                  setSelectedNode(null);
                  if (activeSearch) doSearch(activeSearch);
                }}
                className="text-sm border border-[#d2d2d7] rounded-lg px-3 py-2 bg-white text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              >
                <option value="">All Boards</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>{b.abbreviation || b.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(searchQuery); }}
              placeholder="Search board activity... (votes, meetings, documents, people, projects)"
              className="w-full pl-10 pr-10 py-2.5 text-sm border border-[#d2d2d7] rounded-xl bg-white text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:border-transparent placeholder:text-[#86868b]"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setActiveSearch(""); setSearchResult(null); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f]"
              >
                <X size={14} />
              </button>
            )}
            {searchLoading && (
              <Loader2 size={14} className="absolute right-10 top-1/2 -translate-y-1/2 animate-spin text-[#0071e3]" />
            )}
          </div>

          <QuickFilters onSearch={doSearch} activeQuery={activeSearch} />
        </div>

        <div className="flex-1 flex overflow-hidden">
          {loading && !isSearchActive && !showFullGraph ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-3 text-[#86868b]">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">Loading dashboard…</span>
              </div>
            </div>
          ) : !isSearchActive && !showFullGraph && summaryData ? (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <StatCard
                  icon={Vote} iconColor="#3B82F6" title="Votes" total={summaryData.votes.total}
                  lines={[
                    { label: "Open", value: summaryData.votes.open, color: "text-blue-600" },
                    { label: "Approved", value: summaryData.votes.approved, color: "text-green-600" },
                    { label: "Rejected", value: summaryData.votes.rejected, color: "text-red-600" },
                  ]}
                />
                <StatCard
                  icon={Calendar} iconColor="#10B981" title="Meetings" total={summaryData.meetings.total}
                  lines={[
                    { label: "Upcoming", value: summaryData.meetings.upcoming, color: "text-blue-600" },
                    { label: "Past", value: summaryData.meetings.past },
                  ]}
                />
                <StatCard
                  icon={File} iconColor="#F59E0B" title="Documents" total={summaryData.documents.total}
                  lines={[]}
                />
                <StatCard
                  icon={CheckSquare} iconColor="#EF4444" title="Tasks" total={summaryData.tasks.total}
                  lines={[
                    { label: "Open", value: summaryData.tasks.open, color: "text-blue-600" },
                    { label: "Done", value: summaryData.tasks.done, color: "text-green-600" },
                    { label: "Overdue", value: summaryData.tasks.overdue, color: "text-red-600" },
                  ]}
                />
                <StatCard
                  icon={FileText} iconColor="#14B8A6" title="Minutes" total={summaryData.minutes.total}
                  lines={[
                    { label: "Signed", value: summaryData.minutes.signed, color: "text-green-600" },
                    { label: "In Review", value: summaryData.minutes.review, color: "text-orange-600" },
                    { label: "Draft", value: summaryData.minutes.draft, color: "text-yellow-600" },
                  ]}
                />
                <StatCard
                  icon={Users} iconColor="#8B5CF6" title="People" total={summaryData.people.boardMembers}
                  lines={[
                    { label: "Board members", value: summaryData.people.boardMembers },
                  ]}
                />
              </div>

              <div>
                <h2 className="text-sm font-semibold text-[#1d1d1f] mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#0071e3]" />
                  Project Tracker
                </h2>
                <div className="grid grid-cols-1 gap-4">
                  {summaryData.projects.map((p) => (
                    <ProjectCard key={p.name} project={p} onViewTrail={doSearch} />
                  ))}
                </div>
              </div>

              <DecisionTimeline timeline={summaryData.timeline} onSelectVote={handleTimelineVoteClick} />

              <div className="flex justify-center pb-4">
                <button
                  onClick={handleShowFullGraph}
                  className="text-xs text-[#86868b] hover:text-[#0071e3] flex items-center gap-1.5 py-2 px-4 rounded-full border border-[#e5e5e7] hover:border-[#0071e3] transition-all"
                >
                  <Network size={12} />
                  Show Full Graph
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {searchResult && (
                <div className="px-6 py-2 text-xs text-[#86868b] bg-[#f5f5f7] border-b border-[#e5e5e7]">
                  {searchResult.summary} · {searchResult.nodes.length} nodes · {searchResult.edges.length} connections
                </div>
              )}
              {showFullGraph && fullGraphData && (
                <div className="px-6 py-2 text-xs text-[#86868b] bg-[#f5f5f7] border-b border-[#e5e5e7]">
                  Full graph · {fullGraphData.nodes.length} nodes · {fullGraphData.edges.length} connections
                </div>
              )}

              <div className="flex flex-1 overflow-hidden">
                {graphData ? (
                  <FocusedGraph
                    data={graphData}
                    matchIds={showFullGraph ? new Set(graphData.nodes.map((n) => n.id)) : matchIds}
                    onNodeClick={handleNodeClick}
                    selectedNodeId={selectedNode?.id || null}
                  />
                ) : searchLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-[#0071e3]" />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-[#86868b]">
                    Enter a search term to explore the graph
                  </div>
                )}

                {selectedNode && graphData && (
                  <DetailSidebar
                    node={selectedNode}
                    edges={connectedEdges}
                    allNodes={graphData.nodes}
                    onSelectNode={handleNodeClick}
                    onClose={() => setSelectedNode(null)}
                  />
                )}
              </div>

              {searchResult && searchResult.matches.length > 0 && (
                <ResultsPanel
                  matches={searchResult.matches}
                  onSelect={handleNodeClick}
                  selectedId={selectedNode?.id || null}
                />
              )}
            </div>
          )}
        </div>

        <div className="px-8 py-2.5 border-t border-[#e5e5e7] bg-white flex items-center gap-6 text-xs text-[#86868b]">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="capitalize">{type === "minutes" ? "Minutes" : type + "s"}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
