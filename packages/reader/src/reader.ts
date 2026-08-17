// The headless engine: an OAuth session plus the reads/writes the demo needs
// (getProfile, createReply), wired through two DI seams — createClient and
// createAgent — so tests never touch WebCrypto, IndexedDB, or the network.
import {
  createBrowser,
  publisherForSession,
  type BrowserSession,
  type CreateBrowserOptions,
} from "./browser.js";
import { createSocialActor, type SocialActor } from "./social.js";
import type {
  CreateReplyInput,
  Reader,
  ReaderProfile,
  ReaderSession,
  StrongRef,
} from "./types.js";
import { LEGACY_GENERIC_SCOPE } from "./scopes.js";

export interface CreateReaderOptions extends CreateBrowserOptions {
  /**
   * Permission scope requested at sign-in and embedded in local loopback
   * metadata. Defaults to the legacy broad scope for compatibility. New
   * integrations should pass SOCIAL_SCOPE explicitly.
   */
  scope?: string;
}

export function createReader(options: CreateReaderOptions = {}): Reader {
  const defaultScope = options.scope ?? LEGACY_GENERIC_SCOPE;
  const browser = createBrowser({ ...options, scope: defaultScope });
  let session: BrowserSession | null = null;
  let actor: SocialActor | null = null;

  function setSession(next: BrowserSession | null): void {
    session = next;
    actor = next ? createSocialActor(next) : null;
  }

  let restorePromise: Promise<ReaderSession | null> | null = null;

  return {
    restore(): Promise<ReaderSession | null> {
      return (restorePromise ??= (async () => {
        const restored = await browser.restore();
        if (!restored) return null;
        setSession(restored);
        return {
          did: restored.did,
          handle: restored.handle,
          displayName: restored.displayName,
        };
      })());
    },

    signIn(handle: string, opts?: { state?: string; scope?: string }): Promise<never> {
      return browser.signIn(handle, opts);
    },

    signUp(
      service?: string,
      opts?: { state?: string; scope?: string },
    ): Promise<never> {
      return browser.signUp(service, opts);
    },

    async signOut(): Promise<void> {
      try {
        await browser.signOut();
      } finally {
        setSession(null);
        restorePromise = Promise.resolve(null);
      }
    },

    getProfile(): Promise<ReaderProfile | null> {
      return browser.getProfile();
    },

    async createReply({ root, parent, text }: CreateReplyInput): Promise<StrongRef> {
      if (!actor) throw new Error("createReader: createReply() called while signed out");
      return actor.createReply({ root, parent, text });
    },

    asPublisher() {
      if (!session) {
        throw new Error("createReader: asPublisher() called while signed out");
      }
      return publisherForSession(session);
    },

    async like(subject: StrongRef): Promise<StrongRef> {
      if (!actor) throw new Error("createReader: like() called while signed out");
      return actor.like(subject);
    },

    async unlike(likeUri: string): Promise<void> {
      if (!actor) throw new Error("createReader: unlike() called while signed out");
      await actor.unlike(likeUri);
    },

    async findLike(subjectUri: string): Promise<string | null> {
      return actor ? actor.findLike(subjectUri) : null;
    },

    takeCallbackState(): string | null {
      return browser.takeCallbackState();
    },
  };
}
