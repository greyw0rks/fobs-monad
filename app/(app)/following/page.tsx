import { FeedView } from "@/components/fobs/feed-view";

export const dynamic = "force-dynamic";

export default function FollowingPage() {
  return <FeedView scope="following" />;
}
