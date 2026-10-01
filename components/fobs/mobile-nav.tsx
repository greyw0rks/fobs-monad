"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, TrendingUp, Wallet2, User } from "lucide-react";
import type { Route } from "next";

const ITEMS: { href: Route; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { href: "/feed", label: "Feed", icon: Home },
  { href: "/explore", label: "Explore", icon: TrendingUp },
  { href: "/portfolio", label: "Portfolio", icon: Wallet2 },
  { href: "/following", label: "Following", icon: User }
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t hairline"
      style={{ background: "var(--surface)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2"
            style={{ color: active ? "var(--ink)" : "var(--muted)" }}
          >
            <Icon size={19} />
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 500 }}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
