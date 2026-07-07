import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const roleHome: Record<string, string> = {
  admin: "/secretary",
  member: "/board",
  management: "/management",
  observer: "/observer",
};

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(12, "Password must be at least 12 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

export default function ChangePassword() {
  const [, setLocation] = useLocation();
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  // When the account is flagged for a forced reset (first-boot admin, new member),
  // this screen is mandatory — there is no "cancel" path back into the app.
  const forced = Boolean(user?.mustResetPassword);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not change password");
      }
      await refresh();
      toast({ title: "Password changed", description: "Your new password is now active." });
      setLocation(roleHome[user?.role ?? ""] || "/");
    } catch (err) {
      toast({
        title: "Change failed",
        description: err instanceof Error ? err.message : "Could not change password",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#f5f5f7] p-4">
      <Card className="w-full max-w-md border-0 shadow-lg rounded-[16px] overflow-hidden bg-white">
        <CardHeader className="text-center pb-6 pt-10">
          <div className="mx-auto w-12 h-12 bg-[#0071e3] text-white rounded-xl flex items-center justify-center text-xl font-bold mb-6">
            ✦
          </div>
          <CardTitle className="text-2xl font-semibold text-[#1d1d1f]">
            {forced ? "Set your password" : "Change password"}
          </CardTitle>
          <CardDescription className="text-[#86868b] mt-2">
            {forced
              ? "You're using a one-time password. Choose a new one to continue."
              : "Choose a new password for your account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-10">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#1d1d1f] font-medium">
                      {forced ? "One-time password" : "Current password"}
                    </FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="h-12 rounded-xl bg-[#f5f5f7] border-0 focus-visible:ring-[#0071e3]" data-testid="input-current-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#1d1d1f] font-medium">New password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="At least 12 characters" {...field} className="h-12 rounded-xl bg-[#f5f5f7] border-0 focus-visible:ring-[#0071e3]" data-testid="input-new-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#1d1d1f] font-medium">Confirm new password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Re-enter your new password" {...field} className="h-12 rounded-xl bg-[#f5f5f7] border-0 focus-visible:ring-[#0071e3]" data-testid="input-confirm-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-12 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white font-medium text-base mt-2" disabled={submitting} data-testid="button-submit">
                {submitting ? "Saving..." : "Update password"}
              </Button>
            </form>
          </Form>
        </CardContent>
        {!forced && (
          <CardFooter className="flex justify-center pb-10 pt-4">
            <button
              type="button"
              onClick={() => setLocation(roleHome[user?.role ?? ""] || "/")}
              className="text-sm text-[#86868b] hover:text-[#1d1d1f]"
              data-testid="button-cancel"
            >
              Cancel
            </button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
