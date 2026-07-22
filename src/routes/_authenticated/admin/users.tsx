import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { adminCreateUser, adminDeleteUser, adminSetRole, adminResetPassword } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersPage,
});

interface UserRow {
  id: string; employee_id: string; full_name: string; email: string;
  department: string | null; designation: string | null; phone: string | null;
  is_active: boolean; roles: string[];
}

function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const createFn = useServerFn(adminCreateUser);
  const deleteFn = useServerFn(adminDeleteUser);
  const roleFn = useServerFn(adminSetRole);
  const resetFn = useServerFn(adminResetPassword);

  const q = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const rolesByUser: Record<string, string[]> = {};
      (roles ?? []).forEach((r) => { (rolesByUser[r.user_id] = rolesByUser[r.user_id] ?? []).push(r.role); });
      return (profiles ?? []).map((p) => ({ ...p, roles: rolesByUser[p.id] ?? ["employee"] }));
    },
  });

  const filtered = (q.data ?? []).filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [u.full_name, u.email, u.employee_id, u.department, u.designation]
      .some((v) => (v ?? "").toString().toLowerCase().includes(s));
  });

  const create = useMutation({
    mutationFn: (input: {email: string; password: string; full_name: string; employee_id: string; department: string; designation: string; phone: string; role: "admin" | "manager" | "employee";}) => createFn({ data: input }),
    onSuccess: () => { toast.success("User created"); setOpenNew(false); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h1 className="text-xl sm:text-2xl font-semibold">Users</h1><p className="text-sm text-muted-foreground">{q.data?.length ?? 0} accounts</p></div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild><Button className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" /> New user</Button></DialogTrigger>
          <NewUserDialog onCreate={(input) => create.mutate(input)} pending={create.isPending} />
        </Dialog>
      </div>

      <Card><CardContent className="p-4"><Input placeholder="Search name, email, ID, department…" value={search} onChange={(e) => setSearch(e.target.value)} /></CardContent></Card>

      {filtered.length === 0 ? (
        <Card><div className="text-center py-10 text-muted-foreground text-sm">No users.</div></Card>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {filtered.map((u) => (
              <Card key={u.id}>
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{u.full_name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.employee_id} · {u.email}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.department ?? "—"}{u.designation ? ` · ${u.designation}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <ResetPasswordDialog onReset={(pw) => resetFn({ data: { user_id: u.id, new_password: pw } }).then(() => toast.success("Password reset"))} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="sm" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {u.full_name}?</AlertDialogTitle>
                            <AlertDialogDescription>Removes the user and their bookings. This cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={async () => { await deleteFn({ data: { user_id: u.id } }); qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("User deleted"); }}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {(["admin","manager","employee"] as const).map((r) => (
                      <Badge
                        key={r} variant={u.roles.includes(r) ? "default" : "secondary"}
                        className={`cursor-pointer capitalize ${u.roles.includes(r) ? "" : "opacity-40"}`}
                        onClick={async () => {
                          if (r === "employee") return;
                          await roleFn({ data: { user_id: u.id, role: r, enable: !u.roles.includes(r) } });
                          qc.invalidateQueries({ queryKey: ["admin-users"] });
                          toast.success("Role updated");
                        }}
                      >{r}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tablet/desktop: full table */}
          <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Employee</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Department</th>
                <th className="text-left px-4 py-3">Roles</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><div className="font-medium">{u.full_name}</div><div className="text-xs text-muted-foreground">{u.employee_id}</div></td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.department ?? "—"}<div className="text-xs text-muted-foreground">{u.designation ?? ""}</div></td>
                  <td className="px-4 py-3 space-x-1">
                    {(["admin","manager","employee"] as const).map((r) => (
                      <Badge
                        key={r} variant={u.roles.includes(r) ? "default" : "secondary"}
                        className={`cursor-pointer capitalize ${u.roles.includes(r) ? "" : "opacity-40"}`}
                        onClick={async () => {
                          if (r === "employee") return;
                          await roleFn({ data: { user_id: u.id, role: r, enable: !u.roles.includes(r) } });
                          qc.invalidateQueries({ queryKey: ["admin-users"] });
                          toast.success("Role updated");
                        }}
                      >{r}</Badge>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <ResetPasswordDialog onReset={(pw) => resetFn({ data: { user_id: u.id, new_password: pw } }).then(() => toast.success("Password reset"))} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="sm" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {u.full_name}?</AlertDialogTitle>
                          <AlertDialogDescription>Removes the user and their bookings. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={async () => { await deleteFn({ data: { user_id: u.id } }); qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("User deleted"); }}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function NewUserDialog({ onCreate, pending }: { onCreate: (input: { email: string; password: string; full_name: string; employee_id: string; department: string; designation: string; phone: string; role: "admin"|"manager"|"employee" }) => void; pending: boolean }) {
  const [form, setForm] = useState<{ email: string; password: string; full_name: string; employee_id: string; department: string; designation: string; phone: string; role: "admin"|"manager"|"employee" }>({ email: "", password: "", full_name: "", employee_id: "", department: "", designation: "", phone: "", role: "employee" });
  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>New user</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onCreate(form); }} className="grid gap-3">
        <div><Label>Full name</Label><Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Employee ID</Label><Input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} /></div>
          <div><Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "admin"|"manager"|"employee" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>Email (@sanlayan.com)</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label>Temporary password</Label><Input type="text" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div><Label>Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
        </div>
        <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <DialogFooter><Button type="submit" disabled={pending}>Create</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function ResetPasswordDialog({ onReset }: { onReset: (pw: string) => Promise<unknown> }) {
  const [pw, setPw] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost"><KeyRound className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reset password</DialogTitle></DialogHeader>
        <div className="space-y-2"><Label>New password</Label><Input type="text" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pw.length < 8} onClick={async () => { await onReset(pw); setOpen(false); setPw(""); }}>Reset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
