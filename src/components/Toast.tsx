import { useEffect, useRef, useState } from "react";
import { onToast } from "../lib/toast";

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return onToast((m) => {
      setMsg(m);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), 2200);
    });
  }, []);

  if (msg == null) return null;
  return <div className="toast">{msg}</div>;
}
