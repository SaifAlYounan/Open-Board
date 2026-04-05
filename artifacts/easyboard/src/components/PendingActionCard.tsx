import { useState } from "react";
import { Check, Edit2, X, Bot } from "lucide-react";
import { PendingAction } from "@workspace/api-client-react";
import { useApprovePendingAction, useRejectPendingAction } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function PendingActionCard({ action }: { action: PendingAction }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(JSON.stringify(action.actionData, null, 2));
  const approveMutation = useApprovePendingAction();
  const rejectMutation = useRejectPendingAction();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleApprove = () => {
    approveMutation.mutate({ id: action.id, data: {} }, {
      onSuccess: () => {
        toast({ title: "Action approved" });
        queryClient.invalidateQueries({ queryKey: ["/api/pending-actions"] });
      }
    });
  };

  const handleReject = () => {
    rejectMutation.mutate({ id: action.id, data: {} }, {
      onSuccess: () => {
        toast({ title: "Action rejected" });
        queryClient.invalidateQueries({ queryKey: ["/api/pending-actions"] });
      }
    });
  };

  const handleSaveEdit = () => {
    try {
      const parsed = JSON.parse(editData);
      approveMutation.mutate({ id: action.id, data: { actionData: parsed } }, {
        onSuccess: () => {
          toast({ title: "Action modified and approved" });
          setIsEditing(false);
          queryClient.invalidateQueries({ queryKey: ["/api/pending-actions"] });
        }
      });
    } catch (e) {
      toast({ title: "Invalid JSON", variant: "destructive" });
    }
  };

  if (action.status !== 'pending') return null;

  const confidence = action.aiConfidence ? Math.round(action.aiConfidence * 100) : 0;
  
  return (
    <div className="bg-white border border-[#e8e8ed] rounded-xl p-5 shadow-sm" data-testid={`card-pending-action-${action.id}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-[#0071e3]/10 p-2 rounded-lg text-[#0071e3]">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#1d1d1f] capitalize">{action.actionType.replace(/_/g, ' ')}</span>
              {confidence > 0 && (
                <span className="text-xs font-medium text-[#86868b] bg-[#f5f5f7] px-2 py-0.5 rounded">
                  {confidence}% confidence
                </span>
              )}
            </div>
            {action.documentTitle && (
              <p className="text-sm text-[#86868b] mt-0.5">From: {action.documentTitle}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-5 text-sm text-[#1d1d1f] bg-[#f5f5f7] p-3 rounded-lg border border-[#e8e8ed]/50">
        {action.aiDescription || "No description provided."}
      </div>

      <div className="flex items-center gap-2">
        <Button 
          onClick={handleApprove} 
          disabled={approveMutation.isPending || rejectMutation.isPending}
          className="bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-lg flex-1"
          data-testid={`button-approve-${action.id}`}
        >
          <Check className="w-4 h-4 mr-2" /> Approve
        </Button>
        
        <Dialog open={isEditing} onOpenChange={setIsEditing}>
          <DialogTrigger asChild>
            <Button variant="outline" className="rounded-lg bg-white border-[#e8e8ed] text-[#1d1d1f] hover:bg-[#f5f5f7]">
              <Edit2 className="w-4 h-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit Action Data</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Textarea 
                value={editData}
                onChange={e => setEditData(e.target.value)}
                className="font-mono text-sm min-h-[300px] bg-[#f5f5f7] border-0"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
              <Button onClick={handleSaveEdit} className="bg-[#0071e3] hover:bg-[#0077ed] text-white">
                Save & Approve
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Button 
          onClick={handleReject}
          variant="outline"
          disabled={approveMutation.isPending || rejectMutation.isPending}
          className="rounded-lg bg-white border-[#ff3b30]/20 text-[#ff3b30] hover:bg-[#ff3b30]/10 hover:border-[#ff3b30]/30"
          data-testid={`button-reject-${action.id}`}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}