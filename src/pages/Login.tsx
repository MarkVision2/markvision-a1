import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MarketingPanel } from "@/components/auth/MarketingPanel";
import { AuthForm } from "@/components/auth/AuthForm";

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate("/dashboard", { replace: true });
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/dashboard", { replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="grid h-screen w-full grid-cols-1 overflow-hidden lg:grid-cols-[1.1fr_1fr]">
      <MarketingPanel />
      <div className="flex h-full items-center justify-center bg-background px-6 py-8 sm:px-10">
        <AuthForm />
      </div>
    </div>
  );
}
