"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, TrendingUp, Users, Compass, Wallet2, Bell } from "lucide-react";
import type { Route } from "next";
import { ConnectWalletButton } from "./connect-wallet-button";

type NavItem = { href: Route; label: string; icon: React.ComponentType<{ size?: number }> };

const PRIMARY: NavItem[] = [
  { href: "/feed", label: "Home", icon: Home },
  { href: "/explore", label: "Trending", icon: TrendingUp },
  { href: "/following", label: "Following", icon: Users },
  { href: "/explore", label: "Markets", icon: Compass }
];

const SECONDARY: NavItem[] = [
  { href: "/portfolio", label: "Portfolio", icon: Wallet2 },
  { href: "/notifications", label: "Activity", icon: Bell }
];

export function FobsSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const renderItem = (item: NavItem, key: number) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={`${item.href}-${key}`}
        href={item.href}
        className="flex items-center gap-3 px-3 h-9 rounded-md row-hover"
        style={{
          color: active ? "var(--ink)" : "var(--muted)",
          background: active ? "var(--surface-2)" : "transparent",
          fontWeight: active ? 600 : 500
        }}
      >
        <Icon size={17} />
        <span style={{ fontSize: "var(--t-md)" }}>{item.label}</span>
      </Link>
    );
  };

  return (
    <aside
      className="hidden lg:flex flex-col shrink-0 border-r hairline"
      style={{ width: 232, background: "var(--surface)" }}
    >
      <div className="h-14 flex items-center px-5 border-b hairline">
        <Link href={"/feed" as Route} className="flex items-center gap-2">
          <span
            className="num"
            style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--ink)" }}
          >
            fobs
          </span>
          <span className="chip" style={{ height: 18 }}>
            Monad
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        <div className="eyebrow px-3 mb-1">Discover</div>
        {PRIMARY.map(renderItem)}
        <div className="eyebrow px-3 mb-1 mt-5">You</div>
        {SECONDARY.map(renderItem)}
      </nav>

      <div className="p-3 border-t hairline">
        <ConnectWalletButton />
      </div>
    </aside>
  );
}
