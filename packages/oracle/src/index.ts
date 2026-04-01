/**
 * VaultLayer Non-Renewal Trigger Oracle
 *
 * Polls Aptos for active escrow agreements whose trigger conditions are
 * satisfied, then submits `execute_trigger` permissionlessly.
 *
 * Configuration (via .env or environment variables):
 *   ORACLE_PRIVATE_KEY     — Ed25519 private key hex (the oracle's wallet)
 *   CONTRACT_ADDRESS       — Deployed vaultlayer::escrow module address
 *   APTOS_NODE_URL         — Aptos fullnode RPC URL
 *   AGREEMENT_IDS          — Comma-separated list of agreement IDs to watch
 *   POLL_INTERVAL_MS       — Poll interval in ms (default: 300000 = 5 min)
 *   DRY_RUN                — If "true", skip tx submission (log only)
 */

import 'dotenv/config';
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

const ORACLE_PRIVATE_KEY  = requireEnv('ORACLE_PRIVATE_KEY');
const CONTRACT_ADDRESS    = requireEnv('CONTRACT_ADDRESS');
const APTOS_NODE_URL      = process.env['APTOS_NODE_URL'] ?? 'https://fullnode.mainnet.aptoslabs.com/v1';
const POLL_INTERVAL_MS    = parseInt(process.env['POLL_INTERVAL_MS'] ?? '300000', 10);
const DRY_RUN             = process.env['DRY_RUN'] === 'true';

const rawIds = process.env['AGREEMENT_IDS'] ?? '';
const AGREEMENT_IDS: bigint[] = rawIds
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => BigInt(s));

if (AGREEMENT_IDS.length === 0) {
  console.error('No AGREEMENT_IDS configured. Set AGREEMENT_IDS=1,2,3 in your .env');
  process.exit(1);
}

// ─── Aptos client ─────────────────────────────────────────────────────────────

const aptos = new Aptos(new AptosConfig({ fullnode: APTOS_NODE_URL }));
const oracle = Account.fromPrivateKey({
  privateKey: new Ed25519PrivateKey(ORACLE_PRIVATE_KEY),
});

// ─── State ────────────────────────────────────────────────────────────────────

/** IDs that have already been triggered in this session (or confirmed triggered on-chain). */
const triggered = new Set<bigint>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

/**
 * Call the `is_trigger_met` view function on-chain.
 * Returns false (not an error) if the agreement doesn't exist or isn't active.
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
    // Agreement may not exist yet or the node may be temporarily unavailable.
    log('WARN', `is_trigger_met(${agreementId}) error: ${String(err)}`);
    return false;
  }
}

/**
 * Call `get_state` to confirm whether an agreement is still active (state == 1).
 * Used to skip agreements that were already triggered between polls.
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
    return -1; // unknown / not found
  }
}

/**
 * Submit `execute_trigger` for the given agreement.
 * The function is permissionless — the oracle's key is only needed to pay gas.
 */
async function executeTrigger(agreementId: bigint): Promise<string> {
  const transaction = await aptos.transaction.build.simple({
    sender: oracle.accountAddress,
    data: {
      function: `${CONTRACT_ADDRESS}::escrow::execute_trigger`,
      functionArguments: [new U64(agreementId)],
    },
  });

  const senderAuth = aptos.transaction.sign({ signer: oracle, transaction });
  const response = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator: senderAuth,
  });

  await aptos.waitForTransaction({ transactionHash: response.hash });
  return response.hash;
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  log('INFO', `Polling ${AGREEMENT_IDS.length} agreement(s)...`);

  for (const id of AGREEMENT_IDS) {
    if (triggered.has(id)) {
      // Already executed in a previous cycle; verify on-chain state once more.
      const state = await getState(id);
      if (state === 2) {
        // Confirmed triggered — nothing to do.
        continue;
      }
      // State changed back somehow (unlikely) — reset local cache.
      triggered.delete(id);
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
      continue;
    }

    try {
      const txHash = await executeTrigger(id);
      log('INFO', `Agreement #${id}: execute_trigger submitted — tx ${txHash}`);
      triggered.add(id);
    } catch (err) {
      log('ERROR', `Agreement #${id}: execute_trigger failed — ${String(err)}`);
      // Do not add to triggered set; will retry next poll.
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('INFO', '─────────────────────────────────────────');
  log('INFO', 'VaultLayer Trigger Oracle starting up');
  log('INFO', `Oracle address  : ${oracle.accountAddress.toString()}`);
  log('INFO', `Contract        : ${CONTRACT_ADDRESS}`);
  log('INFO', `Node URL        : ${APTOS_NODE_URL}`);
  log('INFO', `Watching IDs    : ${AGREEMENT_IDS.join(', ')}`);
  log('INFO', `Poll interval   : ${POLL_INTERVAL_MS / 1000}s`);
  log('INFO', `Dry run         : ${DRY_RUN}`);
  log('INFO', '─────────────────────────────────────────');

  // Run once immediately, then on interval.
  await poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  // Graceful shutdown.
  const shutdown = (signal: string) => {
    log('INFO', `${signal} received — shutting down`);
    clearInterval(timer);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
