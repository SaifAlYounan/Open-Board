import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function ForgotPasswordDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      toast({
        title: "Check with your Board Secretary",
        description:
          body.message ||
          "If that email is registered, a reset link has been generated. Email delivery isn't configured, so your Secretary relays the link.",
      });
      setOpen(false);
      setEmail("");
    } catch {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="text-sm text-[#0071e3] hover:underline" data-testid="button-forgot-password">
          Forgot password?
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>
            Enter your account email. If it's registered, a single-use reset link is generated.
            Email delivery isn't configured yet, so your Board Secretary relays the link to you.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="input-forgot-email"
          />
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={submitting || !email} data-testid="button-forgot-submit">
            {submitting ? "Sending..." : "Send reset link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const loginMutation = useLogin();
  const { toast } = useToast();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate({ data }, {
      onSuccess: (res) => {
        login("", res.user);
        
        switch (res.user.role) {
          case 'admin':
            setLocation("/secretary");
            break;
          case 'member':
            setLocation("/board");
            break;
          case 'management':
            setLocation("/management");
            break;
          case 'observer':
            setLocation("/observer");
            break;
          default:
            setLocation("/");
        }
      },
      onError: (error) => {
        toast({
          title: "Login failed",
          description: error.data?.error || "Invalid credentials",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#f5f5f7] p-4">
      <Card className="w-full max-w-md border-0 shadow-lg rounded-[16px] overflow-hidden bg-white">
        <CardHeader className="text-center pb-8 pt-10">
          <div className="mx-auto w-12 h-12 bg-[#0071e3] text-white rounded-xl flex items-center justify-center text-xl font-bold mb-6">
            ✦
          </div>
          <CardTitle className="text-2xl font-semibold text-[#1d1d1f]">Sign in to LQGovernance</CardTitle>
          <CardDescription className="text-[#86868b] mt-2">Board governance, human-in-the-loop</CardDescription>
        </CardHeader>
        <CardContent className="px-10">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#1d1d1f] font-medium">Email</FormLabel>
                    <FormControl>
                      <Input placeholder="name@meridian-energy.com" {...field} className="h-12 rounded-xl bg-[#f5f5f7] border-0 focus-visible:ring-[#0071e3]" data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#1d1d1f] font-medium">Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="h-12 rounded-xl bg-[#f5f5f7] border-0 focus-visible:ring-[#0071e3]" data-testid="input-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-12 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white font-medium text-base mt-4" disabled={loginMutation.isPending} data-testid="button-submit">
                {loginMutation.isPending ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center pb-10 pt-6">
          <ForgotPasswordDialog />
        </CardFooter>
      </Card>
    </div>
  );
}
