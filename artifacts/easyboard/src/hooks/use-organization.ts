import { useQuery } from "@tanstack/react-query";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface Organization {
  name: string;
  version: string;
}

/** The single organization's identity (name, app version) for UI display. */
export function useOrganization() {
  return useQuery<Organization>({
    queryKey: ["organization"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/organization`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load organization");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
