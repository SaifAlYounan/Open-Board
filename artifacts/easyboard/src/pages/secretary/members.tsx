import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useListPeople } from '@workspace/api-client-react';
import { getAvatarInitials } from '@/lib/auth';

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: 'Secretary', color: '#5856d6' },
  member: { label: 'Board Member', color: '#0071e3' },
  management: { label: 'Management', color: '#ff9500' },
  observer: { label: 'Observer', color: '#34c759' },
};

export default function SecretaryMembers() {
  const { data: people, isLoading } = useListPeople();

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#1d1d1f]">Members</h1>
            <p className="text-sm text-[#86868b] mt-1">All people with access to Open Board</p>
          </div>

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading...</div>}

          {!isLoading && (people as any[] || []).length === 0 && (
            <div className="text-center py-16 text-[#86868b] text-sm bg-white rounded-2xl border border-[#e5e5e7]">
              No members found.
            </div>
          )}

          {(people as any[] || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e7]">
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#86868b] uppercase tracking-wide">Title</th>
                </tr>
              </thead>
              <tbody>
                {(people as any[] || []).map((person: any) => {
                  const roleInfo = ROLE_LABELS[person.role] || { label: person.role, color: '#86868b' };
                  return (
                    <tr key={person.id} className="border-b border-[#f5f5f7] hover:bg-[#f5f5f7] transition-colors" data-testid={`person-row-${person.id}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                            style={{ backgroundColor: person.avatarColor || '#86868b' }}
                          >
                            {getAvatarInitials(person.name)}
                          </div>
                          <span className="font-medium text-[#1d1d1f] text-sm">{person.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#86868b]">{person.email}</td>
                      <td className="px-6 py-4">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                          backgroundColor: roleInfo.color + '15', color: roleInfo.color
                        }}>{roleInfo.label}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#86868b]">{person.title || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}
