import { Link } from "wouter";
import { Compass } from "lucide-react";
import { useAuth } from "@/lib/auth";

const HOME_BY_ROLE: Record<string, string> = {
  admin: "/secretary",
  member: "/board",
  management: "/management",
  observer: "/observer",
};

export default function NotFound() {
  const { user } = useAuth();
  const home = (user && HOME_BY_ROLE[user.role]) || "/";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#f5f5f7] px-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#e5e5e7] p-8 text-center">
        <div className="mx-auto w-12 h-12 bg-[#f5f5f7] text-[#0071e3] rounded-xl flex items-center justify-center mb-5">
          <Compass className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold text-[#1d1d1f]">Page not found</h1>
        <p className="mt-2 text-sm text-[#86868b]">
          The page you're looking for doesn't exist or you don't have access to it.
        </p>
        <Link href={home}>
          <a className="inline-block mt-6 px-4 py-2 bg-[#0071e3] text-white text-sm font-medium rounded-xl hover:bg-[#0077ed] transition-colors">
            {user ? "Back to your dashboard" : "Go to sign in"}
          </a>
        </Link>
      </div>
    </div>
  );
}
