import { useEffect, useState } from "react";
import { authorAuth } from "../hedgerow/browser";

export default function OAuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authorAuth.restore()
      .then((session) => {
        if (!session) throw new Error("The authorization server returned no session.");
        window.location.replace("/sudo");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not finish signing in.");
      });
  }, []);

  return (
    <p role={error ? "alert" : "status"}>
      {error ?? "Finishing sign in…"}
    </p>
  );
}
