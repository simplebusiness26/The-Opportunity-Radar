import type { Untrusted } from '../domain/types/untrusted';
import type { EvidenceClass } from '../domain/taxonomy/evidence-class';
import type { SignalTypeKey } from '../domain/taxonomy/signal-types';
import type { HttpFetcher } from './http';

export type SourceCategory =
  | 'community'
  | 'customer_evidence'
  | 'labour'
  | 'technology'
  | 'market'
  | 'trend'
  | 'regulatory';

export interface ConfigField {
  key: string;
  label: string;
  /** A secret is stored encrypted and never returned. */
  secret: boolean;
  required: boolean;
  hint: string;
  placeholder?: string;
}

/**
 * What an adapter declares about itself.
 *
 * The manifest exists so the interface can explain a source without running it,
 * and so the connection checklist can be generated from the code rather than
 * maintained by hand and drifting out of date.
 */
export interface SourceManifest {
  adapterKey: string;
  name: string;
  category: SourceCategory;
  description: string;
  /** What kind of evidence this source produces at best. */
  evidenceClass: EvidenceClass;
  defaultSignalType: SignalTypeKey;
  /** Empty when the source needs no credentials. */
  configFields: ConfigField[];
  /** Where the owner obtains the credentials, if any. */
  credentialsUrl?: string;
  /** What the terms of service permit, recorded honestly. */
  termsPolicy: string;
  respectsRobots: boolean;
  /** Rough cost to the owner, if the source charges. */
  costNote: string;
}

export interface RawSourceItem {
  /** Stable identifier at the source, used to recognise a re-fetch. */
  externalId: string;
  url: string | null;
  title: string;
  body: Untrusted<string>;
  author: string | null;
  publishedAt: Date | null;
  /** Anything else the source provided, kept for provenance. */
  raw: Record<string, unknown>;
}

export interface NormalizedSourceItem {
  externalId: string;
  url: string | null;
  title: string;
  bodyText: Untrusted<string>;
  authorHandle: string | null;
  publishedAt: Date | null;
  signalTypeKey: SignalTypeKey;
  evidenceClass: EvidenceClass;
  /** URL this item is visibly derived from, when it says so. */
  citesUrl: string | null;
  entityNames: string[];
  monetaryEvidence?: { monthlyAmount?: number; oneOffAmount?: number; currency?: string; quote?: string };
}

export type ConfigStatus =
  | { ok: true }
  | { ok: false; missing: string[]; message: string; remedy: string };

export interface FetchPage {
  items: RawSourceItem[];
  /** Opaque position, stored so the next run resumes rather than restarting. */
  cursor: string | null;
  /** False when there is more to read and the run should continue. */
  exhausted: boolean;
}

export interface SourceHealth {
  ok: boolean;
  message: string;
  /** Set when the owner must do something. */
  remedy?: string;
}

export interface AdapterContext {
  http: HttpFetcher;
  config: Record<string, string>;
  /** Reduced when the budget governor asks for shallower scans. */
  maxItems: number;
  userAgent: string;
}

/**
 * A source of external evidence.
 *
 * Kept small on purpose: an adapter fetches and normalises, and does nothing
 * else. It never writes to the database, never decides what is interesting and
 * never reaches the network except through the injected fetcher, so a new
 * adapter cannot bypass the SSRF, robots or rate-limit rules.
 */
export interface SourceAdapter {
  readonly manifest: SourceManifest;
  validateConfig(config: Record<string, string>): ConfigStatus;
  fetch(context: AdapterContext, cursor: string | null): Promise<FetchPage>;
  normalize(item: RawSourceItem): NormalizedSourceItem;
  healthCheck(context: AdapterContext): Promise<SourceHealth>;
}
