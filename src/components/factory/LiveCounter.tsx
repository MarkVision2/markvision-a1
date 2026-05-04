import { useEffect, useState } from "react";

const START = 12483;

const LiveCounter = () => {
  const [count, setCount] = useState(START);

  useEffect(() => {
    let timer: number;
    const tick = () => {
      setCount((c) => c + 1);
      // 3-5 секунд
      timer = window.setTimeout(tick, 3000 + Math.random() * 2000);
    };
    timer = window.setTimeout(tick, 3000 + Math.random() * 2000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="container pb-16 text-center">
      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/40 px-4 py-2 text-sm text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        Уже создано:{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {count.toLocaleString("ru-RU")}
        </span>{" "}
        креативов за сегодня
      </div>
    </div>
  );
};

export default LiveCounter;