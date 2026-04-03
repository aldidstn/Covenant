export class CovenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CovenantError';
  }
}

export class ConfigurationError extends CovenantError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ShelbyUploadError extends CovenantError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ShelbyUploadError';
  }
}

export class ShelbyDownloadError extends CovenantError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ShelbyDownloadError';
  }
}

export class EncryptionError extends CovenantError {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export class ArchiveError extends CovenantError {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export class MerkleError extends CovenantError {
  constructor(message: string) {
    super(message);
    this.name = 'MerkleError';
  }
}
