import { TokenView } from "@/components/fobs/token-view";

export const dynamic = "force-dynamic";

export default async function TokenPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <TokenView symbol={symbol.toUpperCase()} />;
}
