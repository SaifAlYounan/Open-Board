import React, { useState, useEffect } from "react";
import { SecretarySidebar } from "@/components/SecretarySidebar";
import { ConfirmButton } from "@/components/ConfirmButton";
import { useListPeople, useListBoards, useGetBoard } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPeopleQueryKey, getListBoardsQueryKey, getGetBoardQueryKey } from "@workspace/api-client-react";
import { getAvatarInitials } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Users, Layout, Plus, Pencil, Check, X, UserX, UserCheck, Trash2, ChevronRight, Settings2, RotateCcw, AlertTriangle, ClipboardList, Search, RefreshCw, LogIn, FileText, Vote, CalendarDays, ScrollText, CheckSquare, Database } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: "Secretary", color: "#5856d6" },
  member: { label: "Board Member", color: "#0071e3" },
  management: { label: "Management", color: "#ff9500" },
  observer: { label: "Observer", color: "#34c759" },
};

const BOARD_ROLE_LABELS: Record<string, { label: string; color: string }> = {
  chairperson: { label: "Chairperson", color: "#0071e3" },
  vice_chairperson: { label: "Vice Chairperson", color: "#5856d6" },
  secretary: { label: "Secretary", color: "#5856d6" },
  member: { label: "Member", color: "#86868b" },
  observer: { label: "Observer", color: "#34c759" },
};


// ─── People Tab ──────────────────────────────────────────────────────────────

function PeopleTab() {
  const { data: people, isLoading } = useListPeople();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; title: string; role: string }>({ name: "", title: "", role: "member" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", title: "", role: "member", password: "" });
  const [newCredential, setNewCredential] = useState<{ email: string; password: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const list = (people as any[]) || [];

  async function toggleActive(person: any) {
    const res = await fetch(`${API_BASE}/api/people/${person.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ active: !person.active }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      toast({ title: person.active ? "Account deactivated" : "Account activated" });
    } else {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  }

  function startEdit(person: any) {
    setEditingId(person.id);
    setEditForm({ name: person.name, title: person.title || "", role: person.role });
  }

  async function saveEdit(personId: string) {
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/people/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(editForm),
    });
    setSaving(false);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      setEditingId(null);
      toast({ title: "Person updated" });
    } else {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  }

  async function addPerson() {
    if (!addForm.name || !addForm.email) {
      toast({ title: "Name and email required", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Only send a password if the Secretary typed one; otherwise the server
    // generates a one-time password and returns it.
    const { password, ...rest } = addForm;
    const payload = password ? addForm : rest;
    const res = await fetch(`${API_BASE}/api/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      const created = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      setAddForm({ name: "", email: "", title: "", role: "member", password: "" });
      if (created.oneTimePassword) {
        // Keep the panel open and show the credential — it is shown only once.
        setNewCredential({ email: created.email, password: created.oneTimePassword });
      } else {
        setShowAdd(false);
        setNewCredential(null);
        toast({ title: "Person created", description: "They'll set their own password on first sign-in." });
      }
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: err.error || "Failed to create", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f]">All Users</h2>
          <p className="text-sm text-[#86868b]">Manage access, roles, and activation status</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowAdd(!showAdd)}
          className="bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-xl h-9 px-4 text-sm font-medium"
        >
          <Plus size={14} className="mr-1.5" /> Add Person
        </Button>
      </div>

      {showAdd && (
        <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-[#1d1d1f] text-sm">New Person</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#86868b] mb-1 block">Full Name *</label>
              <input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                className="w-full h-9 px-3 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              />
            </div>
            <div>
              <label className="text-xs text-[#86868b] mb-1 block">Email *</label>
              <input
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="j.smith@meridian-energy.com"
                className="w-full h-9 px-3 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              />
            </div>
            <div>
              <label className="text-xs text-[#86868b] mb-1 block">Title</label>
              <input
                value={addForm.title}
                onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Non-Executive Director"
                className="w-full h-9 px-3 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              />
            </div>
            <div>
              <label className="text-xs text-[#86868b] mb-1 block">Role *</label>
              <select
                value={addForm.role}
                onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full h-9 px-3 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] bg-white"
              >
                <option value="member">Board Member</option>
                <option value="admin">Secretary</option>
                <option value="management">Management</option>
                <option value="observer">Observer</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[#86868b] mb-1 block">Initial Password</label>
              <input
                type="text"
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to auto-generate"
                className="w-full h-9 px-3 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              />
              <p className="text-[11px] text-[#86868b] mt-1">
                Leave blank for a secure one-time password. Either way, the user must set their own on first sign-in.
              </p>
            </div>
          </div>

          {newCredential && (
            <div className="rounded-xl border border-[#b3d9ff] bg-[#f0f7ff] p-4 space-y-2" data-testid="new-credential">
              <p className="text-sm font-semibold text-[#1d1d1f]">One-time password — shown once</p>
              <p className="text-xs text-[#86868b]">
                Relay this to <span className="font-medium">{newCredential.email}</span> over a secure channel.
                They'll be required to change it when they first sign in.
              </p>
              <code className="block select-all font-mono text-sm bg-white border border-[#e5e5e7] rounded-lg px-3 py-2">
                {newCredential.password}
              </code>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setNewCredential(null); setShowAdd(false); }}
                  className="rounded-xl"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)} className="rounded-xl">Cancel</Button>
            <Button
              size="sm"
              onClick={addPerson}
              disabled={saving}
              className="bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-xl"
            >
              {saving ? "Creating..." : "Create Person"}
            </Button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading...</div>}

      <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e5e5e7]">
              <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Name</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Email</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Role</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Title</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Status</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((person: any) => {
              const roleInfo = ROLE_LABELS[person.role] || { label: person.role, color: "#86868b" };
              const isEditing = editingId === person.id;
              const isActive = person.active !== false;

              return (
                <tr
                  key={person.id}
                  className={cn(
                    "border-b border-[#f5f5f7] transition-colors",
                    !isActive && "opacity-50",
                    isEditing ? "bg-[#f0f6ff]" : "hover:bg-[#f5f5f7]"
                  )}
                  data-testid={`admin-person-${person.id}`}
                >
                  <td className="px-6 py-3">
                    {isEditing ? (
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full h-8 px-2 rounded-lg border border-[#0071e3] text-sm focus:outline-none"
                      />
                    ) : (
                      <div className="flex items-center gap-3">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                          style={{ backgroundColor: person.avatarColor || "#86868b" }}
                        >
                          {getAvatarInitials(person.name)}
                        </div>
                        <span className="font-medium text-[#1d1d1f] text-sm">{person.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm text-[#86868b]">{person.email}</td>
                  <td className="px-6 py-3">
                    {isEditing ? (
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                        className="h-8 px-2 rounded-lg border border-[#0071e3] text-sm focus:outline-none bg-white"
                      >
                        <option value="member">Board Member</option>
                        <option value="admin">Secretary</option>
                        <option value="management">Management</option>
                        <option value="observer">Observer</option>
                      </select>
                    ) : (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: roleInfo.color + "15", color: roleInfo.color }}
                      >
                        {roleInfo.label}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm text-[#86868b]">
                    {isEditing ? (
                      <input
                        value={editForm.title}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        className="w-full h-8 px-2 rounded-lg border border-[#0071e3] text-sm focus:outline-none"
                        placeholder="Title"
                      />
                    ) : (
                      person.title || "—"
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      isActive ? "bg-[#34c75915] text-[#34c759]" : "bg-[#ff3b3015] text-[#ff3b30]"
                    )}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveEdit(person.id)}
                            disabled={saving}
                            className="p-1.5 rounded-lg text-[#34c759] hover:bg-[#34c75915] transition-colors"
                            title="Save"
                            aria-label="Save changes"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg text-[#86868b] hover:bg-[#f5f5f7] transition-colors"
                            title="Cancel"
                            aria-label="Cancel edit"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(person)}
                            className="p-1.5 rounded-lg text-[#86868b] hover:bg-[#f5f5f7] transition-colors"
                            title="Edit"
                            aria-label="Edit person"
                          >
                            <Pencil size={14} />
                          </button>
                          {isActive ? (
                            <ConfirmButton
                              onConfirm={() => toggleActive(person)}
                              title="Deactivate this account?"
                              description={`${person.name} will be signed out immediately and won't be able to log in until reactivated.`}
                              confirmLabel="Deactivate"
                              ariaLabel="Deactivate person"
                              className="p-1.5 rounded-lg transition-colors text-[#ff3b30] hover:bg-[#ff3b3015]"
                            >
                              <UserX size={14} />
                            </ConfirmButton>
                          ) : (
                            <button
                              onClick={() => toggleActive(person)}
                              className="p-1.5 rounded-lg transition-colors text-[#34c759] hover:bg-[#34c75915]"
                              title="Activate"
                              aria-label="Activate person"
                              data-testid={`toggle-active-${person.id}`}
                            >
                              <UserCheck size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Board Members Tab ────────────────────────────────────────────────────────

function BoardMembersTab() {
  const { data: boards, isLoading: boardsLoading } = useListBoards();
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: people } = useListPeople();
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberForm, setAddMemberForm] = useState({ personId: "", roleInBoard: "member", votingWeight: "1" });
  const [saving, setSaving] = useState(false);
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [proxyLimitDraft, setProxyLimitDraft] = useState<string | null>(null);

  const boardList = (boards as any[]) || [];
  const selectedBoard = boardList.find((b: any) => b.id === selectedBoardId);

  const { data: boardDetail, isLoading: membersLoading } = useGetBoard(selectedBoardId || "", {
    query: { enabled: !!selectedBoardId } as any,
  });

  const members = (boardDetail as any)?.members || [];
  const allPeople = (people as any[]) || [];
  const memberIds = new Set(members.map((m: any) => m.personId));
  const nonMembers = allPeople.filter((p: any) => !memberIds.has(p.id));

  async function removeMember(personId: string) {
    const res = await fetch(`${API_BASE}/api/boards/${selectedBoardId}/members/${personId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getGetBoardQueryKey(selectedBoardId!) });
      toast({ title: "Member removed" });
    } else {
      toast({ title: "Failed to remove", variant: "destructive" });
    }
  }

  async function addMember() {
    if (!addMemberForm.personId) {
      toast({ title: "Select a person", variant: "destructive" });
      return;
    }
    const weight = parseInt(addMemberForm.votingWeight, 10);
    if (!Number.isInteger(weight) || weight < 1) {
      toast({ title: "Voting weight must be a positive whole number", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/boards/${selectedBoardId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ personId: addMemberForm.personId, roleInBoard: addMemberForm.roleInBoard, votingWeight: weight }),
    });
    setSaving(false);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getGetBoardQueryKey(selectedBoardId!) });
      queryClient.invalidateQueries({ queryKey: getListBoardsQueryKey() });
      setShowAddMember(false);
      setAddMemberForm({ personId: "", roleInBoard: "member", votingWeight: "1" });
      toast({ title: "Member added" });
    } else {
      toast({ title: "Failed to add", variant: "destructive" });
    }
  }

  async function saveProxyLimit() {
    if (proxyLimitDraft == null) return;
    const limit = parseInt(proxyLimitDraft, 10);
    if (!Number.isInteger(limit) || limit < 0) {
      toast({ title: "Proxy limit must be a whole number (0 disables proxies)", variant: "destructive" });
      setProxyLimitDraft(null);
      return;
    }
    if (limit === (selectedBoard?.proxyLimit ?? 1)) {
      setProxyLimitDraft(null);
      return;
    }
    const res = await fetch(`${API_BASE}/api/boards/${selectedBoardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ proxyLimit: limit }),
    });
    setProxyLimitDraft(null);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListBoardsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBoardQueryKey(selectedBoardId!) });
      toast({ title: "Proxy limit updated" });
    } else {
      const err = await res.json().catch(() => null);
      toast({ title: "Failed to update proxy limit", description: err?.error, variant: "destructive" });
    }
  }

  async function saveWeight(m: any) {
    const draft = weightDrafts[m.personId];
    if (draft == null) return;
    const weight = parseInt(draft, 10);
    if (!Number.isInteger(weight) || weight < 1) {
      toast({ title: "Voting weight must be a positive whole number", variant: "destructive" });
      setWeightDrafts((d) => { const n = { ...d }; delete n[m.personId]; return n; });
      return;
    }
    if (weight === m.votingWeight) {
      setWeightDrafts((d) => { const n = { ...d }; delete n[m.personId]; return n; });
      return;
    }
    const res = await fetch(`${API_BASE}/api/boards/${selectedBoardId}/members/${m.personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ votingWeight: weight }),
    });
    setWeightDrafts((d) => { const n = { ...d }; delete n[m.personId]; return n; });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getGetBoardQueryKey(selectedBoardId!) });
      toast({ title: "Voting weight updated", description: "Already-cast ballots keep the weight they were cast with." });
    } else {
      const err = await res.json().catch(() => null);
      toast({ title: "Failed to update weight", description: err?.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1d1d1f]">Board Memberships</h2>
        <p className="text-sm text-[#86868b]">Manage board composition and member roles</p>
      </div>

      <div className="grid grid-cols-[260px_1fr] gap-6">
        <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden self-start">
          {boardsLoading && <div className="p-4 text-sm text-[#86868b]">Loading...</div>}
          {boardList.map((board: any) => (
            <button
              key={board.id}
              onClick={() => { setSelectedBoardId(board.id); setShowAddMember(false); setProxyLimitDraft(null); setWeightDrafts({}); }}
              className={cn(
                "w-full text-left px-4 py-3 flex items-center justify-between border-b border-[#f5f5f7] last:border-0 transition-colors",
                selectedBoardId === board.id ? "bg-[#0071e315]" : "hover:bg-[#f5f5f7]"
              )}
            >
              <div>
                <div className={cn("text-sm font-medium", selectedBoardId === board.id ? "text-[#0071e3]" : "text-[#1d1d1f]")}>
                  {board.abbreviation || board.name}
                </div>
                <div className="text-xs text-[#86868b]">{board.memberCount} members</div>
              </div>
              <ChevronRight size={14} className={cn("flex-shrink-0", selectedBoardId === board.id ? "text-[#0071e3]" : "text-[#c7c7cc]")} />
            </button>
          ))}
        </div>

        <div>
          {!selectedBoardId && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-12 text-center">
              <Layout size={32} className="mx-auto text-[#c7c7cc] mb-3" />
              <p className="text-sm text-[#86868b]">Select a board to manage its members</p>
            </div>
          )}

          {selectedBoardId && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#e5e5e7] flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-[#1d1d1f]">{selectedBoard?.name}</h3>
                  <p className="text-xs text-[#86868b]">{members.length} member{members.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-[#86868b]" title="Max proxies one member may hold on a single vote (0 disables proxy voting)">
                    Proxy limit
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={proxyLimitDraft ?? String(selectedBoard?.proxyLimit ?? 1)}
                      onChange={(e) => setProxyLimitDraft(e.target.value)}
                      onBlur={saveProxyLimit}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="h-7 w-14 px-2 rounded-lg border border-[#e5e5e7] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                      data-testid="input-proxy-limit"
                    />
                  </label>
                  <Button
                    size="sm"
                    onClick={() => setShowAddMember(!showAddMember)}
                    className="bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-xl h-8 px-3 text-xs"
                  >
                    <Plus size={12} className="mr-1" /> Add Member
                  </Button>
                </div>
              </div>

              {showAddMember && (
                <div className="px-6 py-4 border-b border-[#e5e5e7] bg-[#f0f6ff] flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-[#86868b] mb-1 block">Person</label>
                    <select
                      value={addMemberForm.personId}
                      onChange={(e) => setAddMemberForm((f) => ({ ...f, personId: e.target.value }))}
                      className="w-full h-8 px-2 rounded-lg border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] bg-white"
                    >
                      <option value="">Select person...</option>
                      {nonMembers.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#86868b] mb-1 block">Role</label>
                    <select
                      value={addMemberForm.roleInBoard}
                      onChange={(e) => setAddMemberForm((f) => ({ ...f, roleInBoard: e.target.value }))}
                      className="h-8 px-2 rounded-lg border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] bg-white"
                    >
                      <option value="member">Member</option>
                      <option value="chairperson">Chairperson</option>
                      <option value="vice_chairperson">Vice Chairperson</option>
                      <option value="secretary">Secretary</option>
                      <option value="observer">Observer</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#86868b] mb-1 block">Voting weight</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={addMemberForm.votingWeight}
                      onChange={(e) => setAddMemberForm((f) => ({ ...f, votingWeight: e.target.value }))}
                      className="h-8 w-20 px-2 rounded-lg border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] bg-white"
                      data-testid="input-add-member-weight"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={addMember}
                    disabled={saving}
                    className="bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-xl h-8 px-3 text-xs"
                  >
                    {saving ? "Adding..." : "Add"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowAddMember(false)} className="rounded-xl h-8 px-3 text-xs">
                    Cancel
                  </Button>
                </div>
              )}

              {membersLoading ? (
                <div className="p-8 text-center text-sm text-[#86868b]">Loading members...</div>
              ) : members.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#86868b]">No members yet</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#f5f5f7]">
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Member</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Board Role</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">System Role</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Voting Weight</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m: any) => {
                      const boardRoleInfo = BOARD_ROLE_LABELS[m.roleInBoard] || { label: m.roleInBoard, color: "#86868b" };
                      const sysRoleInfo = ROLE_LABELS[m.person?.role] || { label: m.person?.role, color: "#86868b" };
                      return (
                        <tr key={m.id} className="border-b border-[#f5f5f7] hover:bg-[#f9f9f9] transition-colors">
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                                style={{ backgroundColor: m.person?.avatarColor || "#86868b" }}
                              >
                                {getAvatarInitials(m.person?.name || "?")}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-[#1d1d1f]">{m.person?.name}</div>
                                <div className="text-xs text-[#86868b]">{m.person?.title || m.person?.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ backgroundColor: boardRoleInfo.color + "15", color: boardRoleInfo.color }}
                            >
                              {boardRoleInfo.label}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ backgroundColor: sysRoleInfo.color + "15", color: sysRoleInfo.color }}
                            >
                              {sysRoleInfo.label}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            {m.roleInBoard === "observer" || m.roleInBoard === "secretary" ? (
                              <span className="text-xs text-[#86868b]">—</span>
                            ) : (
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={weightDrafts[m.personId] ?? String(m.votingWeight ?? 1)}
                                onChange={(e) => setWeightDrafts((d) => ({ ...d, [m.personId]: e.target.value }))}
                                onBlur={() => saveWeight(m)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                className="h-7 w-16 px-2 rounded-lg border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] bg-white"
                                data-testid={`input-weight-${m.personId}`}
                              />
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <ConfirmButton
                              onConfirm={() => removeMember(m.personId)}
                              title="Remove from board?"
                              description="This person will lose access to this board's meetings, votes, and documents. You can re-add them later."
                              confirmLabel="Remove"
                              ariaLabel="Remove from board"
                              className="p-1.5 rounded-lg text-[#ff3b30] hover:bg-[#ff3b3015] transition-colors"
                            >
                              <Trash2 size={13} />
                            </ConfirmButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Audit Tab ────────────────────────────────────────────────────────────────

const ACTION_CATEGORIES = [
  { id: "", label: "All Actions", icon: ClipboardList },
  { id: "login", label: "Sign-ins", icon: LogIn },
  { id: "document", label: "Documents", icon: FileText },
  { id: "vote", label: "Votes", icon: Vote },
  { id: "meeting", label: "Meetings", icon: CalendarDays },
  { id: "minutes", label: "Minutes", icon: ScrollText },
  { id: "task", label: "Tasks", icon: CheckSquare },
  { id: "data_reset", label: "System", icon: Database },
];

const ACTION_ICONS: Record<string, { icon: React.FC<{size?: number}>, color: string }> = {
  login:                    { icon: LogIn,       color: "#34c759" },
  document_uploaded:        { icon: FileText,    color: "#0071e3" },
  document_viewed:          { icon: FileText,    color: "#86868b" },
  document_deleted:         { icon: FileText,    color: "#ff3b30" },
  vote_created:             { icon: Vote,        color: "#0071e3" },
  vote_cast:                { icon: Vote,        color: "#34c759" },
  vote_extended:            { icon: Vote,        color: "#ff9500" },
  vote_cancelled:           { icon: Vote,        color: "#ff9500" },
  vote_deleted:             { icon: Vote,        color: "#ff3b30" },
  vote_material_uploaded:   { icon: Vote,        color: "#5856d6" },
  vote_material_downloaded: { icon: Vote,        color: "#86868b" },
  meeting_created:          { icon: CalendarDays, color: "#0071e3" },
  meeting_updated:          { icon: CalendarDays, color: "#ff9500" },
  meeting_deleted:          { icon: CalendarDays, color: "#ff3b30" },
  minutes_saved:            { icon: ScrollText,  color: "#0071e3" },
  minutes_status_changed:   { icon: ScrollText,  color: "#ff9500" },
  minutes_signed:           { icon: ScrollText,  color: "#34c759" },
  task_created:             { icon: CheckSquare, color: "#0071e3" },
  task_updated:             { icon: CheckSquare, color: "#ff9500" },
  task_deleted:             { icon: CheckSquare, color: "#ff3b30" },
  task_evidence_uploaded:   { icon: CheckSquare, color: "#5856d6" },
  data_reset:               { icon: Database,    color: "#ff3b30" },
};

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function extractDetail(row: any): string {
  const d = row.details;
  if (!d) return "";
  if (d.filename) return d.filename;
  if (d.title) return d.title;
  if (d.meetingTitle) return d.meetingTitle;
  if (d.taskTitle) return d.taskTitle;
  if (d.voteTitle) return d.voteTitle;
  if (d.boardName) return d.boardName;
  if (d.decision) return `Decision: ${d.decision.replace(/_/g, " ")}`;
  if (d.status) return `Status → ${d.status}`;
  if (d.email) return d.email;
  return "";
}

function AuditTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/audit?limit=500`, { credentials: "include" }).then(r => r.json()),
      fetch(`${API_BASE}/api/audit/people`, { credentials: "include" }).then(r => r.json()),
    ]).then(([logData, peopleData]) => {
      setLogs(Array.isArray(logData) ? logData : []);
      setPeople(Array.isArray(peopleData) ? peopleData : []);
    }).finally(() => setLoading(false));
  }, [refreshKey]);

  const filtered = logs.filter(row => {
    if (personFilter && row.personId !== personFilter) return false;
    if (categoryFilter) {
      if (categoryFilter === "document" && !row.action.startsWith("document")) return false;
      else if (categoryFilter === "vote" && !row.action.startsWith("vote")) return false;
      else if (categoryFilter === "meeting" && !row.action.startsWith("meeting")) return false;
      else if (categoryFilter === "minutes" && !row.action.startsWith("minutes")) return false;
      else if (categoryFilter === "task" && !row.action.startsWith("task")) return false;
      else if (!["document","vote","meeting","minutes","task"].includes(categoryFilter) && categoryFilter && row.action !== categoryFilter) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const label = (row.actionLabel || row.action).toLowerCase();
      const personName = (row.person?.name || "").toLowerCase();
      const detail = extractDetail(row).toLowerCase();
      const ip = (row.ipAddress || "").toLowerCase();
      if (!label.includes(q) && !personName.includes(q) && !detail.includes(q) && !ip.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white border border-[#e5e5e7] rounded-2xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-[#e5e5e7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3]"
            />
          </div>
          {/* Person filter */}
          <select
            value={personFilter}
            onChange={e => setPersonFilter(e.target.value)}
            className="text-sm border border-[#e5e5e7] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] bg-white"
          >
            <option value="">All users</option>
            {people.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="text-sm border border-[#e5e5e7] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] bg-white"
          >
            {ACTION_CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          {/* Refresh */}
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="p-2 rounded-xl border border-[#e5e5e7] text-[#86868b] hover:bg-[#f5f5f7] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <span className="text-xs text-[#86868b] ml-auto">{filtered.length} {filtered.length === 1 ? "entry" : "entries"}</span>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white border border-[#e5e5e7] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-[#86868b]">Loading audit log...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-[#86868b]">
            <ClipboardList size={28} className="mb-2 opacity-30" />
            <p className="text-sm">No log entries found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e7] bg-[#f5f5f7]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wide w-44">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wide">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wide">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wide">Detail</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#86868b] uppercase tracking-wide w-32">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5f5f7]">
                {filtered.map(row => {
                  const actionMeta = ACTION_ICONS[row.action] || { icon: ClipboardList, color: "#86868b" };
                  const Icon = actionMeta.icon;
                  const detail = extractDetail(row);
                  const person = row.person;
                  const initials = person ? getAvatarInitials(person.name) : "?";
                  const roleInfo = ROLE_LABELS[person?.role] || { label: person?.role || "Unknown", color: "#86868b" };
                  return (
                    <tr key={row.id} className="hover:bg-[#f9f9fb] transition-colors">
                      <td className="px-4 py-3 text-xs text-[#86868b] whitespace-nowrap font-mono">{formatTs(row.createdAt)}</td>
                      <td className="px-4 py-3">
                        {person ? (
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                              style={{ backgroundColor: person.avatarColor || "#0071e3" }}
                            >
                              {initials}
                            </div>
                            <div>
                              <div className="text-xs font-medium text-[#1d1d1f] leading-tight">{person.name}</div>
                              <div className="text-[10px]" style={{ color: roleInfo.color }}>{roleInfo.label}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-[#86868b]">System</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span style={{ color: actionMeta.color }}><Icon size={12} /></span>
                          <span className="text-xs font-medium text-[#1d1d1f]">{row.actionLabel || row.action}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#3c3c43] max-w-[200px] truncate" title={detail}>{detail}</td>
                      <td className="px-4 py-3 text-xs text-[#86868b] font-mono">{row.ipAddress || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── System Tab ───────────────────────────────────────────────────────────────

function SystemTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  // The server verifies the admin's real password — the client only requires a non-empty entry.
  const canSubmit = password.length > 0;

  async function handleReset() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/system/reset-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: "RESET", password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      await queryClient.invalidateQueries();
      toast({ title: "Data reset", description: "All transactional data has been cleared." });
      setConfirming(false);
      setPassword("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-[#ff3b3015] text-[#ff3b30] rounded-xl flex items-center justify-center flex-shrink-0">
            <RotateCcw size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[#1d1d1f]">Reset All Data</h3>
            <p className="text-sm text-[#86868b] mt-1 leading-relaxed">
              Clears all meetings, votes, tasks, minutes, and documents from the system. Company structure, people, and board rooms will be preserved.
            </p>

            <div className="mt-4 bg-[#f5f5f7] rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-[#1d1d1f] uppercase tracking-wide">What gets cleared</p>
              <div className="grid grid-cols-2 gap-1 text-sm text-[#3c3c43]">
                {["Meetings & agendas", "Votes & vote records", "Tasks & evidence", "Minutes & signatures", "Documents", "Uploaded files"].map(item => (
                  <div key={item} className="flex items-center gap-1.5">
                    <X size={12} className="text-[#ff3b30] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
              <p className="text-xs font-semibold text-[#1d1d1f] uppercase tracking-wide mt-3">What is preserved</p>
              <div className="grid grid-cols-2 gap-1 text-sm text-[#3c3c43]">
                {["Organisation", "All 20 people", "All 5 board rooms", "Board memberships"].map(item => (
                  <div key={item} className="flex items-center gap-1.5">
                    <Check size={12} className="text-[#34c759] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {!confirming ? (
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => { setConfirming(true); setPassword(""); }}
                  className="flex items-center gap-2 px-4 py-2 bg-[#ff3b30] text-white text-sm font-medium rounded-xl hover:bg-[#d93025] transition-colors"
                >
                  <RotateCcw size={14} />
                  Reset All Data
                </button>
                <span className="text-xs text-[#86868b] italic">for demo only</span>
              </div>
            ) : (
              <div className="mt-4 border border-[#ff3b3040] bg-[#fff5f5] rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#ff3b30]">
                  <AlertTriangle size={16} />
                  <span className="text-sm font-semibold">This cannot be undone. Enter the admin password to confirm.</span>
                </div>
                <input
                  type="password"
                  placeholder="Admin password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && canSubmit && !loading && handleReset()}
                  className="w-48 px-3 py-2 text-sm border border-[#e5e5e7] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#ff3b30]/30"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    disabled={loading || !canSubmit}
                    className="flex items-center gap-2 px-4 py-2 bg-[#ff3b30] text-white text-sm font-medium rounded-xl hover:bg-[#d93025] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? "Resetting..." : "Yes, Reset Everything"}
                  </button>
                  <button
                    onClick={() => { setConfirming(false); setPassword(""); }}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-[#1d1d1f] bg-white border border-[#e5e5e7] rounded-xl hover:bg-[#f5f5f7] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────

const TABS = [
  { id: "people", label: "People", icon: Users },
  { id: "boards", label: "Board Memberships", icon: Layout },
  { id: "audit", label: "Audit Log", icon: ClipboardList },
  { id: "system", label: "System", icon: Settings2 },
];

export default function SecretaryAdmin() {
  const [activeTab, setActiveTab] = useState("people");

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#5856d6] text-white rounded-xl flex items-center justify-center">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">Admin Panel</h1>
              <p className="text-sm text-[#86868b] mt-0.5">Manage users, board memberships, and access</p>
            </div>
          </div>

          <div className="flex gap-1 bg-white border border-[#e5e5e7] rounded-2xl p-1 self-start w-fit">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                  activeTab === id
                    ? "bg-[#0071e3] text-white"
                    : "text-[#1d1d1f] hover:bg-[#f5f5f7]"
                )}
                data-testid={`admin-tab-${id}`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          {activeTab === "people" && <PeopleTab />}
          {activeTab === "boards" && <BoardMembersTab />}
          {activeTab === "audit" && <AuditTab />}
          {activeTab === "system" && <SystemTab />}
        </div>
      </main>
    </div>
  );
}
