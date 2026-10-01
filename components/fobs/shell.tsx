import { FobsSidebar } from "./navigation";
import { FobsTopbar } from "./topbar";
import { MobileNav } from "./mobile-nav";

export function FobsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <FobsSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <FobsTopbar />
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
