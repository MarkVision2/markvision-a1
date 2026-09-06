import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CommandPanel } from "@/components/auth/CommandPanel";
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
    <div className="grid min-h-screen w-full grid-cols-1 overflow-hidden lg:h-screen lg:grid-cols-[1.15fr_1fr]">
      <CommandPanel />
      <div className="flex h-full items-center justify-center bg-background px-6 py-10 sm:px-10">
        <AuthForm />
      </div>
    </div>
  );
}
