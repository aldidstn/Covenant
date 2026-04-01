import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  MoveVector,
  U64,
} from '@aptos-labs/ts-sdk';
import { VaultLayerClient } from '@vaultlayer/sdk';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${clean.length}`);
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── Aptos: record_commit ─────────────────────────────────────────────────────

interface RecordCommitArgs {
  aptos: Aptos;
  vendor: Account;
  contractAddress: string;
  agreementId: bigint;
  blobName: string;
  contentMerkleRoot: string;
  shelbyMerkleRoot: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
}

async function recordCommitOnAptos(args: RecordCommitArgs): Promise<string> {
  const {
    aptos,
    vendor,
    contractAddress,
    agreementId,
    blobName,
    contentMerkleRoot,
    shelbyMerkleRoot,
    encryptedKey,
    iv,
    authTag,
  } = args;

  const transaction = await aptos.transaction.build.simple({
    sender: vendor.accountAddress,
    data: {
      function: `${contractAddress}::escrow::record_commit`,
      functionArguments: [
        new U64(agreementId),
        blobName,
        MoveVector.U8(hexToUint8Array(contentMerkleRoot)),
        MoveVector.U8(hexToUint8Array(shelbyMerkleRoot || '00')),
        MoveVector.U8(hexToUint8Array(encryptedKey)),
        MoveVector.U8(hexToUint8Array(iv)),
        MoveVector.U8(hexToUint8Array(authTag)),
      ],
    },
  });

  const senderAuth = aptos.transaction.sign({ signer: vendor, transaction });
  const response = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator: senderAuth,
  });

  await aptos.waitForTransaction({ transactionHash: response.hash });
  return response.hash;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    // ── Read inputs ──────────────────────────────────────────────────────────
    const shelbyPrivateKey = core.getInput('shelby-private-key', { required: true });
    const aptosPrivateKeyHex = core.getInput('aptos-private-key', { required: true });
    const encryptionKeyHex = core.getInput('encryption-key', { required: true });
    const encryptedKeyHex = core.getInput('encrypted-key', { required: true });
    const shelbyApiKey = core.getInput('shelby-api-key') || undefined;
    const expirationDays = parseInt(core.getInput('expiration-days') || '365', 10);

    const contractAddress = core.getInput('contract-address', { required: true });
    const agreementId = BigInt(core.getInput('agreement-id', { required: true }));
    const aptosNodeUrl =
      core.getInput('aptos-node-url') || 'https://fullnode.mainnet.aptoslabs.com/v1';

    // Derive blob name: prefer explicit input, fall back to repo/ref_name
    const refName = process.env['GITHUB_REF_NAME'] ?? 'unknown';
    const repoName = process.env['GITHUB_REPOSITORY'] ?? 'unknown/repo';
    const blobName = core.getInput('blob-name') || `${repoName}/${refName}`;

    // ── Validate encryption key length ───────────────────────────────────────
    const encryptionKey = Buffer.from(encryptionKeyHex, 'hex');
    if (encryptionKey.length !== 32) {
      throw new Error(
        `encryption-key must be 32 bytes (64 hex chars), got ${encryptionKey.length} bytes`,
      );
    }

    // ── Create git archive of HEAD ───────────────────────────────────────────
    core.info('Creating git archive of repository HEAD...');
    const chunks: Buffer[] = [];
    const exitCode = await exec.exec('git', ['archive', '--format=zip', 'HEAD'], {
      listeners: {
        stdout: (data: Buffer) => chunks.push(data),
      },
      silent: true,
    });
    if (exitCode !== 0) {
      throw new Error('git archive failed. Ensure the action runs in a checked-out repository.');
    }
    const archiveData = Buffer.concat(chunks);
    core.info(`Archive size: ${(archiveData.length / 1024).toFixed(1)} KB`);

    // ── Upload to Shelby via VaultLayer SDK ──────────────────────────────────
    const client = new VaultLayerClient({
      shelbyPrivateKey,
      shelbyApiKey,
      network: 'shelbynet',
    });

    core.info(`Uploading blob "${blobName}" to Shelby (encrypted)...`);
    const result = await client.commit({
      archiveData,
      blobName,
      encryptionKey,
      expirationDays,
    });

    core.info(`Content Merkle root : ${result.contentMerkleRoot}`);
    core.info(`Shelby Merkle root  : ${result.shelbyMerkleRoot || '(not available)'}`);
    core.info(`Shelby account      : ${result.accountAddress}`);
    core.info(`Encrypted size      : ${result.encryptedSize} bytes`);

    // ── Set action outputs ───────────────────────────────────────────────────
    core.setOutput('content-merkle-root', result.contentMerkleRoot);
    core.setOutput('shelby-merkle-root', result.shelbyMerkleRoot);
    core.setOutput('blob-name', result.blobName);
    core.setOutput('account-address', result.accountAddress);

    // ── Record commit on Aptos escrow contract ───────────────────────────────
    core.info('Recording commit on Aptos escrow contract...');
    const aptosConfig = new AptosConfig({ fullnode: aptosNodeUrl });
    const aptos = new Aptos(aptosConfig);

    const vendor = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(aptosPrivateKeyHex),
    });

    const txHash = await recordCommitOnAptos({
      aptos,
      vendor,
      contractAddress,
      agreementId,
      blobName: result.blobName,
      contentMerkleRoot: result.contentMerkleRoot,
      shelbyMerkleRoot: result.shelbyMerkleRoot,
      encryptedKey: encryptedKeyHex,
      iv: result.iv,
      authTag: result.authTag,
    });

    core.info(`Aptos transaction   : ${txHash}`);
    core.info('VaultLayer commit recorded successfully.');
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
