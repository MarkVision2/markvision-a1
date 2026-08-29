import { useCallback, useEffect, useRef } from "react";

/**
 * Проверка «компонент ещё жив» для асинхронных запросов.
 * Ответ может прийти после размонтирования — тогда запись в состояние это и
 * лишняя работа, и unhandled rejection в тестах после teardown.
 */
export function useIsMounted(): () => boolean {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  return useCallback(() => mountedRef.current, []);
}
