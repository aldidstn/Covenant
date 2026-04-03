// GET /api/meta?blobName=…&accountAddress=…
//
// Server-side proxy that fetches a __meta blob from Shelby using a
// service account private key (SHELBY_SERVICE_PRIVATE_KEY env var).
//
// If the env var is not set, returns 501 so the buyer portal falls back
// to manual JSON paste.

import { type NextRequest, NextResponse } from 'next/server';
import { CovenantClient } from '@covenant/sdk';

const SERVICE_KEY = process.env.SHELBY_SERVICE_PRIVATE_KEY;
const META_SUFFIX = '__meta';

let _client: CovenantClient | null = null;

function getClient(): CovenantClient {
  if (!SERVICE_KEY) {
    throw new Error('SHELBY_SERVICE_PRIVATE_KEY is not configured.');
  }
  if (!_client) {
    _client = new CovenantClient({ shelbyPrivateKey: SERVICE_KEY });
  }
  return _client;
}

export async function GET(req: NextRequest) {
  const blobName = req.nextUrl.searchParams.get('blobName');
  const accountAddress = req.nextUrl.searchParams.get('accountAddress');

  if (!blobName || !accountAddress) {
    return NextResponse.json(
      { error: 'blobName and accountAddress query params are required.' },
      { status: 400 },
    );
  }

  if (!SERVICE_KEY) {
    return NextResponse.json(
      { error: 'Service key not configured. Paste the __meta JSON manually.' },
      { status: 501 },
    );
  }

  try {
    const client = getClient();
    // proveInclusion fetches the __meta blob internally; we replicate just the
    // fetch here so the buyer portal can display and cache the raw JSON.
    const metaBlobName = `${blobName}${META_SUFFIX}`;
    const archive = await client.download({
      blobName: metaBlobName,
      accountAddress,
      // __meta blobs are unencrypted — use a zero key; the SDK won't try to
      // decrypt since the blob contains plaintext JSON.
      encryptionKey: Buffer.alloc(32),
      iv: '0'.repeat(24),
      authTag: '0'.repeat(32),
    });
    // archive is raw Buffer of the JSON bytes (no actual decryption needed)
    const meta = JSON.parse(archive.toString('utf8'));
    return NextResponse.json(meta);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch __meta blob: ${String(err)}` },
      { status: 502 },
    );
  }
}
