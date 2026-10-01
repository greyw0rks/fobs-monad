import { FobsShell } from "@/components/fobs/shell";
import { TradeDrawerProvider } from "@/components/fobs/trade-drawer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeDrawerProvider>
      <FobsShell>{children}</FobsShell>
    </TradeDrawerProvider>
  );
}
