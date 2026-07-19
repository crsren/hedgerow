// openInBrowser is the default `openUrl`: it spawns the platform's URL opener.
// We can't launch a real browser in CI, so we stub node:child_process.spawn and
// node:os.platform and assert the right command is chosen per platform. The
// spawned child is detached + unref'd, so the stub returns an object with unref.
import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.fn(() => ({ unref: vi.fn() }));
const platform = vi.fn();

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:os", async (importActual) => ({
  ...(await importActual<typeof import("node:os")>()),
  platform,
}));

// Imported after the mocks are registered (vi.mock is hoisted above imports).
const { openInBrowser } = await import("../src/oauth.js");

const URL = "https://example.com/authorize";

afterEach(() => {
  spawn.mockClear();
});

describe("openInBrowser platform selection", () => {
  it("uses `open` on macOS", () => {
    platform.mockReturnValue("darwin");
    openInBrowser(URL);
    expect(spawn).toHaveBeenCalledWith("open", [URL], expect.objectContaining({ detached: true }));
  });

  it("uses `cmd /c start` on Windows", () => {
    platform.mockReturnValue("win32");
    openInBrowser(URL);
    expect(spawn).toHaveBeenCalledWith("cmd", ["/c", "start", "", URL], expect.anything());
  });

  it("uses `xdg-open` on Linux/other", () => {
    platform.mockReturnValue("linux");
    openInBrowser(URL);
    expect(spawn).toHaveBeenCalledWith("xdg-open", [URL], expect.anything());
  });

  it("detaches and unrefs the child so the CLI can exit", () => {
    platform.mockReturnValue("darwin");
    const unref = vi.fn();
    spawn.mockReturnValueOnce({ unref });
    openInBrowser(URL);
    expect(unref).toHaveBeenCalled();
    expect((spawn.mock.calls[0] as unknown[])[2]).toMatchObject({ stdio: "ignore", detached: true });
  });
});
