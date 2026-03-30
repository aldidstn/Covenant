export class VaultLayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultLayerError';
  }
}

export class ConfigurationError extends VaultLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ShelbyUploadError extends VaultLayerError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ShelbyUploadError';
  }
}

export class ShelbyDownloadError extends VaultLayerError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ShelbyDownloadError';
  }
}

export class EncryptionError extends VaultLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export class ArchiveError extends VaultLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export class MerkleError extends VaultLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'MerkleError';
  }
}
