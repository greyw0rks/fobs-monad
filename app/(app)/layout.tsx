import { FobsShell } from "@/components/fobs/shell";
import { TradeDrawerProvider } from "@/components/fobs/trade-drawer";
import { BridgeDrawerProvider } from "@/components/fobs/bridge-drawer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeDrawerProvider>
      <BridgeDrawerProvider>
        <FobsShell>{children}</FobsShell>
      </BridgeDrawerProvider>
    </TradeDrawerProvider>
  );
}
