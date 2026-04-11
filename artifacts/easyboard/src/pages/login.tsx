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
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

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
          <CardTitle className="text-2xl font-semibold text-[#1d1d1f]">Sign in to EasyBoard <span className="text-red-600">DEMO</span></CardTitle>
          <CardDescription className="text-[#86868b] mt-2">Meridian Energy Group</CardDescription>
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
          <p className="text-sm text-[#86868b]" data-testid="text-forgot-password">
            Forgot password? Contact your Board Secretary.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
