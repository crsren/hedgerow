import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL doesn't auto-clean under vitest; unmount between tests so effects/state
// from one render never bleed into the next.
afterEach(cleanup);
