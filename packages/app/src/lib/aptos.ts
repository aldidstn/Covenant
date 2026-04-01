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
