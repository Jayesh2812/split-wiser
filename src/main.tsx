import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PublicSettlement } from "./components/PublicSettlement";
import { readRoute } from "./lib/route";
import "./styles.css";

/**
 * The published-settlement page is chosen HERE rather than inside <App/>, because
 * hooks cannot be conditional: mounting App would run writeRoute (which replaces
 * /s/<token> with the active group's path, destroying the link on refresh) and
 * materialiseRecurring (which WRITES to Firestore). Neither may happen for a
 * signed-out stranger reading someone else's settlement.
 *
 * Read once at module scope: there is no popstate listener anywhere in the app,
 * and the public page navigates away with a plain <a href="/">, not pushState.
 */
const route = readRoute();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {route.kind === "public" ? <PublicSettlement token={route.token} /> : <App />}
  </StrictMode>,
);
