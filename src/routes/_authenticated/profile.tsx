import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSessionUser } from "@/lib/use-session";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { data: user } = useSessionUser();
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: "", phone: "", department: "", designation: "", dob: "" });
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user) setForm({
      full_name: user.fullName,
      phone: user.phone ?? "",
      department: user.department ?? "",
      designation: user.designation ?? "",
      dob: user.dob ?? "",
    });
  }, [user]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase.from("profiles").update({
        full_name: form.full_name, phone: form.phone,
        department: form.department, designation: form.designation,
        dob: form.dob || null,
      } as never).eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Profile updated"); qc.invalidateQueries({ queryKey: ["session-user"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Password updated"); setPassword(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">My profile</h1>
        <p className="text-sm text-muted-foreground">Keep your details up to date.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Personal information</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><Label>Employee ID</Label><Input value={user.employeeId} disabled /></div>
          <div><Label>Email</Label><Input value={user.email} disabled /></div>
          <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div><Label>Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
          <div><Label>Date of birth</Label><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
          <div className="sm:col-span-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save changes</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Change password</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><Label>New password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></div>
          <div className="sm:col-span-2"><Button onClick={() => changePassword.mutate()} disabled={password.length < 8 || changePassword.isPending}>Update password</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
