import { useState } from "react";
import { SecretarySidebar } from "@/components/SecretarySidebar";
import { useListPeople, useListBoards, useGetBoard } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPeopleQueryKey, getListBoardsQueryKey, getGetBoardQueryKey } from "@workspace/api-client-react";
import { getAvatarInitials } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Users, Layout, Plus, Pencil, Check, X, UserX, UserCheck, Trash2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: "Secretary", color: "#5856d6" },
  member: { label: "Board Member", color: "#0071e3" },
  management: { label: "Management", color: "#ff9500" },
  observer: { label: "Observer", color: "#34c759" },
};

const BOARD_ROLE_LABELS: Record<string, { label: string; color: string }> = {
  chair: { label: "Chair", color: "#0071e3" },
  secretary: { label: "Secretary", color: "#5856d6" },
  member: { label: "Member", color: "#86868b" },
  observer: { label: "Observer", color: "#34c759" },
};

function getToken() {
  return localStorage.getItem("token");
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

// ─── People Tab ──────────────────────────────────────────────────────────────

function PeopleTab() {
  const { data: people, isLoading } = useListPeople();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; title: string; role: string }>({ name: "", title: "", role: "member" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", title: "", role: "member", password: "Meridian2024!" });
  const [saving, setSaving] = useState(false);

  const list = (people as any[]) || [];

  async function toggleActive(person: any) {
    const res = await fetch(`${API_BASE}/api/people/${person.id}`, {
      method: "PATCH",
      headers: authHeaders(),
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
      headers: authHeaders(),
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
    if (!addForm.name || !addForm.email || !addForm.password) {
      toast({ title: "Name, email, and password required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/people`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(addForm),
    });
    setSaving(false);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      setShowAdd(false);
      setAddForm({ name: "", email: "", title: "", role: "member", password: "Meridian2024!" });
      toast({ title: "Person created" });
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
              <label className="text-xs text-[#86868b] mb-1 block">Initial Password *</label>
              <input
                type="text"
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full h-9 px-3 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              />
            </div>
          </div>
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
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg text-[#86868b] hover:bg-[#f5f5f7] transition-colors"
                            title="Cancel"
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
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActive(person)}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors",
                              isActive
                                ? "text-[#ff3b30] hover:bg-[#ff3b3015]"
                                : "text-[#34c759] hover:bg-[#34c75915]"
                            )}
                            title={isActive ? "Deactivate" : "Activate"}
                            data-testid={`toggle-active-${person.id}`}
                          >
                            {isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                          </button>
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
  const [addMemberForm, setAddMemberForm] = useState({ personId: "", roleInBoard: "member" });
  const [saving, setSaving] = useState(false);

  const boardList = (boards as any[]) || [];
  const selectedBoard = boardList.find((b: any) => b.id === selectedBoardId);

  const { data: boardDetail, isLoading: membersLoading } = useGetBoard(selectedBoardId || "", {
    query: { enabled: !!selectedBoardId },
  });

  const members = (boardDetail as any)?.members || [];
  const allPeople = (people as any[]) || [];
  const memberIds = new Set(members.map((m: any) => m.personId));
  const nonMembers = allPeople.filter((p: any) => !memberIds.has(p.id));

  async function removeMember(personId: string) {
    const res = await fetch(`${API_BASE}/api/boards/${selectedBoardId}/members/${personId}`, {
      method: "DELETE",
      headers: authHeaders(),
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
    setSaving(true);
    const res = await fetch(`${API_BASE}/api/boards/${selectedBoardId}/members`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(addMemberForm),
    });
    setSaving(false);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getGetBoardQueryKey(selectedBoardId!) });
      queryClient.invalidateQueries({ queryKey: getListBoardsQueryKey() });
      setShowAddMember(false);
      setAddMemberForm({ personId: "", roleInBoard: "member" });
      toast({ title: "Member added" });
    } else {
      toast({ title: "Failed to add", variant: "destructive" });
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
              onClick={() => { setSelectedBoardId(board.id); setShowAddMember(false); }}
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
                <Button
                  size="sm"
                  onClick={() => setShowAddMember(!showAddMember)}
                  className="bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-xl h-8 px-3 text-xs"
                >
                  <Plus size={12} className="mr-1" /> Add Member
                </Button>
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
                      <option value="chair">Chair</option>
                      <option value="secretary">Secretary</option>
                      <option value="observer">Observer</option>
                    </select>
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
                          <td className="px-6 py-3 text-right">
                            <button
                              onClick={() => removeMember(m.personId)}
                              className="p-1.5 rounded-lg text-[#ff3b30] hover:bg-[#ff3b3015] transition-colors"
                              title="Remove from board"
                            >
                              <Trash2 size={13} />
                            </button>
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

// ─── Main Admin Panel ─────────────────────────────────────────────────────────

const TABS = [
  { id: "people", label: "People", icon: Users },
  { id: "boards", label: "Board Memberships", icon: Layout },
];

export default function SecretaryAdmin() {
  const [activeTab, setActiveTab] = useState("people");

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
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
        </div>
      </main>
    </div>
  );
}
