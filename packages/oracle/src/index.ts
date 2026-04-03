/**
 * Covenant Non-Renewal Trigger Oracle
 *
 * Polls Aptos for active escrow agreements whose trigger conditions are
 * satisfied, then submits `execute_trigger` permissionlessly.
 *
 * Auto-discovers new agreements by sequentially probing agreement IDs
 * starting from the last known cursor — no manual ID configuration needed.
 *
 * Configuration (via .env or environment variables):
 *   ORACLE_PRIVATE_KEY     — Ed25519 private key hex (the oracle's wallet)
 *   CONTRACT_ADDRESS       — Deployed covenant::escrow module address
 *   APTOS_NODE_URL         — Aptos fullnode RPC URL
 *   SEED_AGREEMENT_IDS     — Optional comma-separated IDs to watch from start
 *   POLL_INTERVAL_MS       — Poll interval in ms (default: 300000 = 5 min)
 *   DRY_RUN                — If "true", skip tx submission (log only)
 *   STATE_FILE             — Path to JSON state file (default: ./data/state.json)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  U64,
} from '@aptos-labs/ts-sdk';

// ─── Config ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const ORACLE_PRIVATE_KEY = requireEnv('ORACLE_PRIVATE_KEY');
const CONTRACT_ADDRESS   = requireEnv('CONTRACT_ADDRESS');
const APTOS_NODE_URL     = process.env['APTOS_NODE_URL'] ?? 'https://fullnode.mainnet.aptoslabs.com/v1';
const POLL_INTERVAL_MS   = parseInt(process.env['POLL_INTERVAL_MS'] ?? '300000', 10);
const DRY_RUN            = process.env['DRY_RUN'] === 'true';
const STATE_FILE         = process.env['STATE_FILE'] ?? path.join(process.cwd(), 'data', 'state.json');

/** Optional seed IDs — useful for adding agreements created before the oracle started. */
const SEED_IDS: bigint[] = (process.env['SEED_AGREEMENT_IDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => BigInt(s));

// ─── State (persisted to STATE_FILE) ─────────────────────────────────────────

interface PersistedState {
  /** Highest agreement ID we have ever seen. New IDs are probed above this. */
  cursor: string;
  /** IDs confirmed as STATE_TRIGGERED (2) — never re-checked. */
  triggered: string[];
  /** All IDs currently being watched (active + pending). */
  watching: string[];
}

const DEFAULT_STATE: PersistedState = {
  cursor: '0',
  triggered: [],
  watching: [],
};

function loadState(): PersistedState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) } as PersistedState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: PersistedState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ─── Aptos client ─────────────────────────────────────────────────────────────

const aptos  = new Aptos(new AptosConfig({ fullnode: APTOS_NODE_URL }));
const oracle = Account.fromPrivateKey({
  privateKey: new Ed25519PrivateKey(ORACLE_PRIVATE_KEY),
});

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

// ─── Chain queries ────────────────────────────────────────────────────────────

/**
 * Returns the on-chain state of an agreement, or -1 if not found.
 *   0 = PENDING, 1 = ACTIVE, 2 = TRIGGERED, -1 = not found
 */
async function getState(agreementId: bigint): Promise<number> {
  try {
    const [state] = await aptos.view({
      payload: {
        function: `${CONTRACT_ADDRESS}::escrow::get_state`,
        functionArguments: [agreementId.toString()],
      },
    });
    return Number(state);
  } catch {
    return -1;
  }
}

/**
 * Returns true if `is_trigger_met` returns true for an active agreement.
 */
async function isTriggerMet(agreementId: bigint): Promise<boolean> {
  try {
    const [met] = await aptos.view({
      payload: {
        function: `${CONTRACT_ADDRESS}::escrow::is_trigger_met`,
        functionArguments: [agreementId.toString()],
      },
    });
    return Boolean(met);
  } catch (err) {
    log('WARN', `is_trigger_met(${agreementId}) error: ${String(err)}`);
    return false;
  }
}

// ─── Auto-discovery ───────────────────────────────────────────────────────────

/**
 * Probe agreement IDs starting from `cursor + 1` until we get a "not found"
 * response. Agreement IDs are sequential (the contract increments next_id),
 * so any gap means we've reached the end.
 *
 * Returns the list of newly discovered IDs and the updated cursor.
 */
async function discoverNewAgreements(
  cursor: bigint,
): Promise<{ found: bigint[]; newCursor: bigint }> {
  const found: bigint[] = [];
  let probeId = cursor + 1n;
  const PROBE_LIMIT = 100n; // safety cap per poll cycle

  while (probeId - cursor <= PROBE_LIMIT) {
    const state = await getState(probeId);
    if (state === -1) break; // no agreement at this ID — stop probing
    found.push(probeId);
    log('INFO', `Discovered new agreement #${probeId} (state=${state})`);
    probeId++;
  }

  const newCursor = found.length > 0 ? found[found.length - 1]! : cursor;
  return { found, newCursor };
}

// ─── Trigger execution ────────────────────────────────────────────────────────

async function executeTrigger(agreementId: bigint): Promise<string> {
  const transaction = await aptos.transaction.build.simple({
    sender: oracle.accountAddress,
    data: {
      function: `${CONTRACT_ADDRESS}::escrow::execute_trigger`,
      functionArguments: [new U64(agreementId)],
    },
  });

  const senderAuth = aptos.transaction.sign({ signer: oracle, transaction });
  const response   = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator: senderAuth,
  });

  await aptos.waitForTransaction({ transactionHash: response.hash });
  return response.hash;
}

// ─── Main poll cycle ──────────────────────────────────────────────────────────

async function poll(state: PersistedState): Promise<void> {
  let cursor    = BigInt(state.cursor);
  const triggered = new Set<bigint>(state.triggered.map(BigInt));
  const watching  = new Set<bigint>(state.watching.map(BigInt));

  // Merge seed IDs
  for (const id of SEED_IDS) {
    if (!watching.has(id) && !triggered.has(id)) {
      watching.add(id);
      if (id > cursor) cursor = id;
      log('INFO', `Seeded agreement #${id} from SEED_AGREEMENT_IDS`);
    }
  }

  // ── Discover new agreements ───────────────────────────────────────────────
  const { found, newCursor } = await discoverNewAgreements(cursor);
  for (const id of found) {
    if (!triggered.has(id)) watching.add(id);
  }
  cursor = newCursor;

  log('INFO', `Watching ${watching.size} agreement(s) (cursor=${cursor})`);

  // ── Check and execute triggers ────────────────────────────────────────────
  for (const id of watching) {
    if (triggered.has(id)) continue;

    // Confirm still active on-chain (may have been triggered by someone else)
    const onChainState = await getState(id);
    if (onChainState === 2) {
      log('INFO', `Agreement #${id}: already triggered on-chain — removing from watch list`);
      triggered.add(id);
      watching.delete(id);
      continue;
    }
    if (onChainState !== 1) {
      // PENDING or not found — skip without logging spam
      continue;
    }

    const met = await isTriggerMet(id);
    if (!met) {
      log('INFO', `Agreement #${id}: trigger not yet met — skipping`);
      continue;
    }

    log('INFO', `Agreement #${id}: trigger condition MET`);

    if (DRY_RUN) {
      log('INFO', `[DRY RUN] Would submit execute_trigger for agreement #${id}`);
      triggered.add(id);
      watching.delete(id);
      continue;
    }

    try {
      const txHash = await executeTrigger(id);
      log('INFO', `Agreement #${id}: trigger executed — tx ${txHash}`);
      triggered.add(id);
      watching.delete(id);
    } catch (err) {
      log('ERROR', `Agreement #${id}: execute_trigger failed — ${String(err)}`);
      // Keep in watching set; will retry next poll.
    }
  }

  // ── Persist updated state ─────────────────────────────────────────────────
  state.cursor    = cursor.toString();
  state.triggered = [...triggered].map(String);
  state.watching  = [...watching].map(String);
  saveState(state);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('INFO', '─────────────────────────────────────────');
  log('INFO', 'Covenant Trigger Oracle starting up');
  log('INFO', `Oracle address  : ${oracle.accountAddress.toString()}`);
  log('INFO', `Contract        : ${CONTRACT_ADDRESS}`);
  log('INFO', `Node URL        : ${APTOS_NODE_URL}`);
  log('INFO', `Poll interval   : ${POLL_INTERVAL_MS / 1000}s`);
  log('INFO', `State file      : ${STATE_FILE}`);
  log('INFO', `Dry run         : ${DRY_RUN}`);
  log('INFO', '─────────────────────────────────────────');

  const state = loadState();
  log('INFO', `Resuming from cursor=${state.cursor}, watching=[${state.watching.join(',')}], triggered=[${state.triggered.join(',')}]`);

  // Run one cycle immediately, then on interval.
  await poll(state);
  const timer = setInterval(() => poll(state), POLL_INTERVAL_MS);

  const shutdown = (signal: string) => {
    log('INFO', `${signal} received — saving state and shutting down`);
    saveState(state);
    clearInterval(timer);
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
