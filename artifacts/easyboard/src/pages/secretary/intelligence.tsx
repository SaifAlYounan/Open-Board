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
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relationship: string;
}

const NODE_COLORS: Record<string, string> = {
  board: "#D4A017",
  person: "#6B7280",
  vote: "#3B82F6",
  meeting: "#10B981",
  minutes: "#F59E0B",
  document: "#8B5CF6",
  task: "#EF4444",
};

const NODE_RADII: Record<string, number> = {
  board: 24,
  person: 16,
  vote: 12,
  meeting: 12,
  minutes: 8,
  document: 8,
  task: 8,
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
    case "vote":
      return `/secretary/votes/${node.id}`;
    case "meeting":
      return `/secretary/meetings/${node.id}`;
    case "minutes":
      return `/secretary/minutes/${node.id}`;
    case "task":
      return `/secretary/tasks/${node.id}`;
    case "document":
      return `/secretary/documents`;
    default:
      return null;
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
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || "bg-gray-100 text-gray-600"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function Intelligence() {
  const { user } = useAuth();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [connectedEdges, setConnectedEdges] = useState<(GraphEdge & { otherNode: GraphNode })[]>([]);
  const [boards, setBoards] = useState<{ id: string; name: string; abbreviation: string }[]>([]);
  const [filterBoardId, setFilterBoardId] = useState<string>("");

  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/boards?limit=100`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBoards(data);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = filterBoardId
      ? `${API_BASE}/api/graph?boardId=${filterBoardId}`
      : `${API_BASE}/api/graph`;
    fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load graph data");
        return r.json();
      })
      .then((data) => {
        setGraphData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [filterBoardId]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (!graphData) return;
      setSelectedNode(node);
      const related = graphData.edges
        .filter((e) => e.source === node.id || e.target === node.id)
        .map((e) => {
          const otherId = e.source === node.id ? e.target : e.source;
          const otherNode = graphData.nodes.find((n) => n.id === otherId);
          return { ...e, otherNode: otherNode! };
        })
        .filter((e) => e.otherNode);
      setConnectedEdges(related);
    },
    [graphData],
  );

  useEffect(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;
    if (graphData.nodes.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    const simNodes: SimNode[] = graphData.nodes.map((n) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = graphData.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        relationship: e.relationship,
      }));

    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        "link",
        d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(100),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => NODE_RADII[d.type] + 4));

    simulationRef.current = simulation;

    const link = g
      .append("g")
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#d1d5db")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1);

    const nodeGroup = g
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    nodeGroup
      .append("circle")
      .attr("r", (d) => NODE_RADII[d.type])
      .attr("fill", (d) => NODE_COLORS[d.type])
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    nodeGroup
      .append("text")
      .text((d) => {
        const maxLen = d.type === "board" ? 8 : 14;
        return d.label.length > maxLen ? d.label.slice(0, maxLen) + "…" : d.label;
      })
      .attr("text-anchor", "middle")
      .attr("dy", (d) => NODE_RADII[d.type] + 14)
      .attr("font-size", "10px")
      .attr("fill", "#4B5563")
      .attr("pointer-events", "none");

    nodeGroup.on("click", (_event, d) => {
      handleNodeClick(d);
    });

    nodeGroup.on("mouseover", function (_event, d) {
      const connectedIds = new Set<string>();
      connectedIds.add(d.id);
      simLinks.forEach((l) => {
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        if (src === d.id) connectedIds.add(tgt);
        if (tgt === d.id) connectedIds.add(src);
      });

      nodeGroup.attr("opacity", (n) => (connectedIds.has(n.id) ? 1 : 0.15));
      link.attr("stroke-opacity", (l) => {
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return src === d.id || tgt === d.id ? 0.8 : 0.05;
      });
    });

    nodeGroup.on("mouseout", () => {
      nodeGroup.attr("opacity", 1);
      link.attr("stroke-opacity", 0.5);
    });

    nodeGroup.on("dblclick", (_event, d) => {
      const scale = 1.5;
      const transform = d3.zoomIdentity
        .translate(width / 2 - d.x * scale, height / 2 - d.y * scale)
        .scale(scale);
      svg.transition().duration(500).call(zoom.transform, transform);
    });

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x)
        .attr("y1", (d) => (d.source as SimNode).y)
        .attr("x2", (d) => (d.target as SimNode).x)
        .attr("y2", (d) => (d.target as SimNode).y);

      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [graphData, handleNodeClick]);

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-hidden flex flex-col">
        <div className="px-8 py-6 border-b border-[#e5e5e7] bg-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Network size={20} className="text-[#0071e3]" />
            <h1 className="text-xl font-semibold text-[#1d1d1f]">Board Intelligence</h1>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={filterBoardId}
              onChange={(e) => {
                setFilterBoardId(e.target.value);
                setSelectedNode(null);
              }}
              className="text-sm border border-[#d2d2d7] rounded-lg px-3 py-2 bg-white text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
            >
              <option value="">All Boards</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.abbreviation || b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 flex relative">
          <div
            ref={containerRef}
            className="flex-1 bg-[#f8f9fa]"
            style={{ minHeight: 600 }}
          >
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="flex items-center gap-3 text-[#86868b]">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm">Loading graph…</span>
                </div>
              </div>
            )}
            {error && !graphData && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-sm text-red-500">{error}</div>
              </div>
            )}
            {!loading && !error && graphData && graphData.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center max-w-md">
                  <Network size={48} className="mx-auto text-[#d2d2d7] mb-4" />
                  <p className="text-sm text-[#86868b]">
                    Upload documents and create votes to see your board intelligence graph grow.
                  </p>
                </div>
              </div>
            )}
            <svg ref={svgRef} className="w-full h-full" />
          </div>

          {selectedNode && (
            <div className="w-80 bg-white border-l border-[#e5e5e7] overflow-y-auto animate-in slide-in-from-right duration-200">
              <div className="p-5 border-b border-[#e5e5e7] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = TYPE_ICONS[selectedNode.type] || Layers;
                    return (
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: NODE_COLORS[selectedNode.type] + "20" }}
                      >
                        <Icon size={16} style={{ color: NODE_COLORS[selectedNode.type] }} />
                      </div>
                    );
                  })()}
                  <div>
                    <div className="text-xs text-[#86868b] capitalize">{selectedNode.type}</div>
                    <div className="text-sm font-semibold text-[#1d1d1f]">{selectedNode.label}</div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-[#86868b] hover:text-[#1d1d1f] transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {selectedNode.status && (
                  <div>
                    <div className="text-xs text-[#86868b] mb-1">Status</div>
                    <StatusBadge status={selectedNode.status} />
                  </div>
                )}
                {selectedNode.date && (
                  <div>
                    <div className="text-xs text-[#86868b] mb-1">Date</div>
                    <div className="text-sm text-[#1d1d1f]">
                      {new Date(selectedNode.date).toLocaleDateString()}
                    </div>
                  </div>
                )}
                {selectedNode.role && (
                  <div>
                    <div className="text-xs text-[#86868b] mb-1">Role</div>
                    <div className="text-sm text-[#1d1d1f] capitalize">{selectedNode.role}</div>
                  </div>
                )}

                {(() => {
                  const link = getNodeLink(selectedNode);
                  if (!link) return null;
                  return (
                    <Link href={link}>
                      <div className="flex items-center gap-2 text-sm text-[#0071e3] hover:underline cursor-pointer">
                        <ExternalLink size={14} />
                        View {selectedNode.type}
                      </div>
                    </Link>
                  );
                })()}

                <div>
                  <div className="text-xs text-[#86868b] mb-2">
                    Connections ({connectedEdges.length})
                  </div>
                  <div className="space-y-2">
                    {connectedEdges.map((edge, i) => {
                      const Icon = TYPE_ICONS[edge.otherNode.type] || Layers;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-[#f5f5f7] cursor-pointer transition-colors"
                          onClick={() => handleNodeClick(edge.otherNode)}
                        >
                          <Icon
                            size={14}
                            style={{ color: NODE_COLORS[edge.otherNode.type] }}
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-[#1d1d1f] truncate">
                              {edge.otherNode.label}
                            </div>
                            <div className="text-xs text-[#86868b]">{edge.relationship}</div>
                          </div>
                        </div>
                      );
                    })}
                    {connectedEdges.length === 0 && (
                      <div className="text-xs text-[#86868b]">No connections</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-8 py-3 border-t border-[#e5e5e7] bg-white flex items-center gap-6 text-xs text-[#86868b]">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="capitalize">{type === "minutes" ? "Minutes" : type + "s"}</span>
            </div>
          ))}
          {graphData && (
            <div className="ml-auto">
              {graphData.nodes.length} nodes · {graphData.edges.length} connections
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
