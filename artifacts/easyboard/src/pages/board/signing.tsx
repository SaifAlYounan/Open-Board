import { useState } from 'react';
import DOMPurify from 'dompurify';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { useAuth } from '@/lib/auth';
import {
  useGetMinutes, useSignMinutes, getGetMinutesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { PenLine, CheckCircle, ArrowLeft } from 'lucide-react';

export default function MinutesSigning() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: minutes, isLoading } = useGetMinutes(id, { query: { queryKey: getGetMinutesQueryKey(id) } });
  const signMinutes = useSignMinutes();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [passphrase, setPassphrase] = useState('');
  const [justSigned, setJustSigned] = useState<{ ref: string; signedAt: string } | null>(null);

  const m = minutes as any;
  const myExistingSig = m?.signatures?.find((s: any) => s.personId === user?.id);
  const hasSigned = m?.hasSigned || !!myExistingSig || !!justSigned;

  const handleSign = () => {
    if (!passphrase) {
      toast({ title: 'Passphrase required', description: 'Enter your signing passphrase to sign.', variant: 'destructive' });
      return;
    }
    signMinutes.mutate({ id, data: { passphrase } }, {
      onSuccess: (res: any) => {
        toast({ title: 'Minutes signed', description: 'Your Ed25519 signature has been recorded.' });
        // A signature is not a hash — show a short reference to it, not "the hash".
        setJustSigned({ ref: (res.signature || res.contentSha256 || '').slice(0, 32), signedAt: res.signedAt || new Date().toISOString() });
        setPassphrase('');
        queryClient.invalidateQueries({ queryKey: getGetMinutesQueryKey(id) });
      },
      onError: (err: any) => {
        const code = err.data?.code;
        if (err.status === 409) {
          toast({ title: 'Already signed', description: 'You have already signed these minutes.' });
        } else if (code === 'signing_key_required') {
          toast({ title: 'No signing key', description: 'Enroll a signing key in your account settings before signing.', variant: 'destructive' });
        } else if (code === 'mfa_enrollment_required' || code === 'mfa_required' || code === 'mfa_reverification_required') {
          toast({ title: 'Two-factor required', description: err.data?.error, variant: 'destructive' });
        } else if (err.status === 401) {
          toast({ title: 'Wrong passphrase', description: 'That signing passphrase is not correct.', variant: 'destructive' });
        } else {
          toast({ title: 'Signing failed', description: err.data?.error, variant: 'destructive' });
        }
      }
    });
  };

  if (isLoading) return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <div className="pt-20 flex items-center justify-center py-16 text-[#86868b] text-sm">Loading...</div>
    </div>
  );

  const sigRef = justSigned?.ref || myExistingSig?.signature || myExistingSig?.contentSha256;

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-2xl mx-auto space-y-6">
        <button onClick={() => setLocation(`/board/minutes/${id}`)}
          className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] transition-colors">
          <ArrowLeft size={14} /> Back to minutes
        </button>

        <div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">Sign Minutes</h1>
          <div className="text-sm text-[#86868b] mt-1">{m?.meetingTitle || 'Board Minutes'}</div>
        </div>

        {/* Minutes content (read-only, scrollable) */}
        <div className="bg-white rounded-2xl border border-[#e5e5e7] p-8 max-h-96 overflow-y-auto">
          <div
            className="prose prose-sm max-w-none text-[#1d1d1f]"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m?.content || '') }}
          />
        </div>

        {/* Existing signatures */}
        {m?.signatures?.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-4">Signatures</div>
            <div className="space-y-4">
              {m.signatures.map((sig: any) => (
                <div key={sig.id} className="flex items-start gap-3" data-testid={`existing-sig-${sig.id}`}>
                  <CheckCircle size={16} className="text-[#34c759] mt-1 flex-shrink-0" />
                  <div>
                    <div
                      className="text-2xl font-signature text-[#1d1d1f] leading-tight"
                      style={{ fontFamily: "'Dancing Script', cursive" }}
                    >
                      {sig.person?.name || 'Unknown'}
                    </div>
                    <div className="text-xs text-[#86868b] font-mono mt-0.5">
                      {sig.signature ? `${sig.algorithm || 'Ed25519'}: ${sig.signature.slice(0, 20)}…` : 'legacy signature (unverifiable)'}
                    </div>
                    <div className="text-xs text-[#86868b]">{new Date(sig.signedAt).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My signature or sign button */}
        <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
          {hasSigned ? (
            <div className="space-y-3" data-testid="signature-block">
              <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide">Your Signature</div>
              <div
                className="signature-appear text-3xl text-[#1d1d1f] leading-tight py-2"
                style={{ fontFamily: "'Dancing Script', cursive" }}
                data-testid="signature-text"
              >
                {user?.name}
              </div>
              <div className="text-xs text-[#86868b] font-mono break-all">
                {sigRef ? `${sigRef.slice(0, 32)}…` : ''}
              </div>
              <div className="text-xs text-[#34c759] flex items-center gap-1">
                <CheckCircle size={12} /> Ed25519 signed
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-[#1d1d1f]">Your Signature</div>
                <div className="text-xs text-[#86868b] mt-0.5">By signing, you confirm these minutes are accurate. Your personal Ed25519 key signs them — enter your signing passphrase to unlock it.</div>
              </div>
              <div
                className="text-3xl text-[#86868b] py-2 leading-tight border-b border-[#e5e5e7]"
                style={{ fontFamily: "'Dancing Script', cursive" }}
              >
                {user?.name}
              </div>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Signing passphrase"
                autoComplete="off"
                className="w-full px-4 py-2.5 rounded-xl border border-[#e5e5e7] text-sm focus:outline-none focus:border-[#0071e3]"
                data-testid="input-passphrase"
                onKeyDown={(e) => { if (e.key === 'Enter' && passphrase && !signMinutes.isPending) handleSign(); }}
              />
              <button
                onClick={handleSign}
                disabled={signMinutes.isPending || !passphrase}
                className="flex items-center gap-2 px-6 py-3 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50"
                data-testid="button-sign"
              >
                <PenLine size={16} />
                {signMinutes.isPending ? 'Signing...' : 'Sign Minutes'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
