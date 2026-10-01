import { SearchBar } from "./search-bar";
import { ConnectWalletButton } from "./connect-wallet-button";

export function FobsTopbar() {
  return (
    <header
      className="h-14 shrink-0 flex items-center gap-3 px-4 border-b hairline sticky top-0 z-40"
      style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)", backdropFilter: "blur(8px)" }}
    >
      {/* mobile logo */}
      <div className="lg:hidden flex items-center gap-2">
        <span className="num" style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em" }}>
          fobs
        </span>
        <span className="chip" style={{ height: 18 }}>
          Monad
        </span>
      </div>
      <SearchBar />
      <div className="flex-1" />
      <div className="hidden sm:block">
        <ConnectWalletButton compact />
      </div>
    </header>
  );
}
