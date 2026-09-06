import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * Выход из аккаунта: гасит сессию Supabase и возвращает на страницу входа.
 * Подтверждение — чтобы случайный клик не выкинул из рабочей сессии.
 */
export function SignOutButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      toast.error("Не удалось выйти", { description: message });
    } finally {
      setLoading(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setConfirm(true)}
        className={className}
        aria-label="Выйти из аккаунта"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Выйти из аккаунта
      </Button>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выйти из аккаунта?</AlertDialogTitle>
            <AlertDialogDescription>
              {user?.email
                ? `Сессия ${user.email} будет завершена, вы вернётесь на страницу входа.`
                : "Сессия будет завершена, вы вернётесь на страницу входа."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleSignOut(); }}
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              Выйти
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default SignOutButton;
