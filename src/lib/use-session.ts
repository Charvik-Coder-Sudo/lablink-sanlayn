import { useQuery } from "@tanstack/react-query";
import { loadSessionUser, type SessionUser } from "./session";

export function useSessionUser() {
  return useQuery<SessionUser | null>({
    queryKey: ["session-user"],
    queryFn: loadSessionUser,
    staleTime: 60_000,
  });
}
