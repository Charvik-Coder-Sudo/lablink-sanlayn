import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isCompanyEmail } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCompanyEmail(email)) {
      toast.error("Only @sanlayan.com email addresses are permitted.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Invalid credentials");
      return;
    }
    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
      action: "login",
      description: `${email} signed in`,
    });
    toast.success("Welcome back");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Brand side */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-secondary text-secondary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,var(--color-primary),transparent_60%)]" />
        <div className="relative">
          <div className="text-2xl font-bold tracking-tight">SANLAYAN</div>
          <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.24em] text-secondary-foreground/60">
            Lab Management System
          </div>
        </div>
        <div className="relative">
          <h1 className="text-3xl font-semibold leading-tight max-w-md">
            Lab Equipment Booking Management System
          </h1>
          <p className="mt-4 text-sm text-secondary-foreground/70 max-w-md">
            Reserve laboratory equipment, manage inventory and view utilization reports across departments — all in one internal workspace.
          </p>
        </div>
        <div className="relative text-xs text-secondary-foreground/50">
          © {new Date().getFullYear()} SANLAYAN Technologies · Internal Use Only
        </div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md shadow-elevated border-border">
          <CardContent className="p-8">
            <div className="lg:hidden mb-6">
              <BrandMark size={28} className="mb-2" />
              <div className="text-xl font-bold tracking-tight">SANLAYAN</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground mt-1">
                Lab Management System
              </div>
            </div>
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Use your company account to continue.
            </p>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Company email</Label>
                <Input
                  id="email" type="email" required autoComplete="email"
                  placeholder="john.doe@sanlayan.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password" type="password" required autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Sign in
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Accounts are provisioned by your administrator. No self-registration.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
