import { Aptos, AptosConfig } from '@aptos-labs/ts-sdk';
import { APTOS_NODE_URL, CONTRACT_ADDRESS } from './constants';

let _client: Aptos | null = null;

function client(): Aptos {
  if (!_client) {
    _client = new Aptos(new AptosConfig({ fullnode: APTOS_NODE_URL }));
  }
  return _client;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgreementTimestamps {
  expiryTimestamp: number;
  lastCommitAt: number;
  eolNoticeAt: number;
}

// ─── View functions ───────────────────────────────────────────────────────────

export async function fetchState(agreementId: number): Promise<number> {
  const [state] = await client().view({
    payload: {
      function: `${CONTRACT_ADDRESS}::escrow::get_state`,
      functionArguments: [agreementId.toString()],
    },
  });
  return Number(state);
}

export async function fetchContentMerkleRoot(agreementId: number): Promise<string> {
  const [root] = await client().view({
    payload: {
      function: `${CONTRACT_ADDRESS}::escrow::get_content_merkle_root`,
      functionArguments: [agreementId.toString()],
    },
  });
  // The SDK returns vector<u8> as an array of numbers.
  if (Array.isArray(root)) {
    return Buffer.from(root as number[]).toString('hex');
  }
  return String(root);
}

export async function fetchTimestamps(
  agreementId: number,
): Promise<AgreementTimestamps> {
  const result = await client().view({
    payload: {
      function: `${CONTRACT_ADDRESS}::escrow::get_timestamps`,
      functionArguments: [agreementId.toString()],
    },
  });
  const [expiry, lastCommit, eolNotice] = result as [string, string, string];
  return {
    expiryTimestamp: Number(expiry),
    lastCommitAt: Number(lastCommit),
    eolNoticeAt: Number(eolNotice),
  };
}

export async function fetchIsTriggerMet(agreementId: number): Promise<boolean> {
  const [met] = await client().view({
    payload: {
      function: `${CONTRACT_ADDRESS}::escrow::is_trigger_met`,
      functionArguments: [agreementId.toString()],
    },
  });
  return Boolean(met);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch all four on-chain fields for a dashboard card in one round-trip set. */
export async function fetchAgreementOnChain(agreementId: number) {
  const [state, merkleRoot, timestamps, triggerMet] = await Promise.all([
    fetchState(agreementId),
    fetchContentMerkleRoot(agreementId),
    fetchTimestamps(agreementId),
    fetchIsTriggerMet(agreementId),
  ]);
  return { state, merkleRoot, timestamps, triggerMet };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export interface RegistryEntry {
  id: number;
  state: number;
  expiryTimestamp: number;
  lastCommitAt: number;
}

/**
 * Probe sequential agreement IDs to build a paginated registry.
 * The contract assigns IDs starting from 1 with no gaps, so we probe
 * upward until we get a "not found" error.
 *
 * Fetches in parallel batches for performance (BATCH_SIZE concurrent calls).
 *
 * @param fromId  First ID to probe (1-based). Use 1 for the first page.
 * @param limit   Max entries to return per page.
 * @returns entries found and the next fromId to use for the following page
 *          (or null if there are no more agreements).
 */
export async function fetchRegistryPage(
  fromId: number,
  limit: number,
): Promise<{ entries: RegistryEntry[]; nextFromId: number | null }> {
  const BATCH_SIZE = 5;
  const entries: RegistryEntry[] = [];
  let id = fromId;
  let reachedEnd = false;

  while (entries.length < limit && !reachedEnd) {
    const batchIds = Array.from(
      { length: Math.min(BATCH_SIZE, limit - entries.length) },
      (_, i) => id + i,
    );

    const results = await Promise.allSettled(
      batchIds.map(async (probeId) => {
        const state = await fetchState(probeId);
        let expiryTimestamp = 0;
        let lastCommitAt = 0;
        try {
          const ts = await fetchTimestamps(probeId);
          expiryTimestamp = ts.expiryTimestamp;
          lastCommitAt = ts.lastCommitAt;
        } catch { /* non-fatal */ }
        return { id: probeId, state, expiryTimestamp, lastCommitAt } as RegistryEntry;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        entries.push(result.value);
      } else {
        reachedEnd = true;
        break;
      }
    }

    id += batchIds.length;
  }

  return { entries, nextFromId: reachedEnd ? null : id };
}
