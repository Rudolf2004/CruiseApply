import { AuthScreen } from "@/features/auth/auth-screen";
export const metadata = { title: "Staff Login" };
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <AuthScreen mode="login" confirmationError={(await searchParams).error === "confirmation"}/>;
}
