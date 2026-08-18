import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListUsersResponse } from "@bulk-github-update-tool/shared-types";
import { apiGet, apiPost } from "../api/client";

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
      <table className="results-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {usersQuery.data.users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>
                <span className={`badge ${user.role === "admin" ? "" : "badge--muted"}`}>{user.role}</span>
              </td>
              <td>{new Date(user.createdAt).toLocaleString()}</td>
              <td>
                <div className="admin-users__actions">
                  {user.role !== "admin" && (
                    <button
                      type="button"
                      className="button-link"
                      disabled={promoteMutation.isPending}
                      onClick={() => promoteMutation.mutate(user.id)}
                    >
                      Promote to admin
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => {
                      setResetTargetId(user.id);
                      setNewPassword("");
                    }}
                  >
                    Reset password
                  </button>
                </div>
                {resetTargetId === user.id && (
                  <div className="admin-users__reset">
                    <input
                      type="password"
                      placeholder="New password (min 8 characters)"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      minLength={8}
                    />
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={newPassword.length < 8 || resetPasswordMutation.isPending}
                      onClick={() => resetPasswordMutation.mutate(user.id)}
                    >
                      Set password
                    </button>
                    <button type="button" className="button-link" onClick={() => setResetTargetId(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
