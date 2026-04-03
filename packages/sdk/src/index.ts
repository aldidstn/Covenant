export { VaultLayerClient } from './client.js';
export { verifyInclusionProof } from './merkle.js';
export { generateKey } from './encryption.js';
export {
  ed25519PublicToX25519,
  ed25519PrivateToX25519,
  wrapKey,
  unwrapKey,
} from './keyexchange.js';
export type { WrappedKey } from './keyexchange.js';
export type {
  VaultLayerConfig,
  CommitOptions,
  CommitResult,
  ProveInclusionOptions,
  InclusionProof,
  DownloadOptions,
  BlobInfo,
  MerkleTreeMeta,
} from './types.js';
export {
  VaultLayerError,
  ConfigurationError,
  ShelbyUploadError,
  ShelbyDownloadError,
  EncryptionError,
  ArchiveError,
  MerkleError,
} from './errors.js';
