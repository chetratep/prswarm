import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListUsersResponse } from "@bulk-github-update-tool/shared-types";
import { apiGet, apiPost } from "../api/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const USERS_QUERY_KEY = ["admin", "users"] as const;

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => apiGet<ListUsersResponse>("/api/users"),
  });

  const promoteMutation = useMutation({
    mutationFn: (userId: string) => apiPost(`/api/users/${userId}/promote`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) =>
      apiPost(`/api/users/${userId}/reset-password`, { newPassword }),
    onSuccess: () => {
      setResetTargetId(null);
      setNewPassword("");
    },
  });

  if (usersQuery.isLoading) {
    return (
      <div className="page">
        <h2>Users</h2>
        <p className="page__loading">Loading users…</p>
      </div>
    );
  }

  if (usersQuery.isError || !usersQuery.data) {
    return (
      <div className="page">
        <h2>Users</h2>
        <p className="form__error" role="alert">
          {usersQuery.error instanceof Error ? usersQuery.error.message : "Failed to load users."}
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Users</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usersQuery.data.users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.username}</TableCell>
              <TableCell>
                <span className={`badge ${user.role === "admin" ? "" : "badge--muted"}`}>{user.role}</span>
              </TableCell>
              <TableCell>{new Date(user.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <div className="admin-users__actions">
                  {user.role !== "admin" && (
                    <Button
                      type="button"
                      variant="link"
                      className="text-link h-auto p-0"
                      disabled={promoteMutation.isPending}
                      onClick={() => promoteMutation.mutate(user.id)}
                    >
                      Promote to admin
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="link"
                    className="text-link h-auto p-0"
                    onClick={() => {
                      setResetTargetId(user.id);
                      setNewPassword("");
                    }}
                  >
                    Reset password
                  </Button>
                </div>
                {resetTargetId === user.id && (
                  <div className="admin-users__reset">
                    <PasswordInput
                      placeholder="New password (min 8 characters)"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      minLength={8}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={newPassword.length < 8 || resetPasswordMutation.isPending}
                      onClick={() => resetPasswordMutation.mutate(user.id)}
                    >
                      Set password
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="text-link h-auto p-0"
                      onClick={() => setResetTargetId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
