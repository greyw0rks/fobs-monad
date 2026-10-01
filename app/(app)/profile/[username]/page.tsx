import { ProfileView } from "@/components/fobs/profile-view";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={username.toLowerCase()} />;
}
