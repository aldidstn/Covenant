/// Covenant Escrow — Phase 1
///
/// Stores escrow agreements between a software vendor and a buyer on Aptos.
/// Each agreement references a source-code blob on Shelby Protocol and
/// holds the cryptographic commitments (Merkle roots) needed for
/// self-serve verification.
///
/// Two trigger types are supported:
///   - Non-renewal  : fires if the vendor does not call `renew` before
///                    `expiry_timestamp`.
///   - Manual EOL   : fires 48 h after the vendor calls `notify_eol`.
///
/// When a trigger fires, the smart contract emits a `TriggerExecuted` event
/// containing the Shelby blob location and the buyer-encrypted symmetric key.
/// The buyer decrypts the key with their private key, then fetches and
/// decrypts the source archive from Shelby.
module covenant::escrow {

    use std::string::String;
    use std::signer;
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};

    // ─── Constants ──────────────────────────────────────────────────────────

    /// Agreement has been created by the vendor; awaiting buyer acceptance.
    const STATE_PENDING: u8   = 0;
    /// Both parties have signed on-chain; deposits are live.
    const STATE_ACTIVE: u8    = 1;
    /// A trigger condition fired; the encrypted key has been released.
    const STATE_TRIGGERED: u8 = 2;

    /// Trigger fired because the vendor did not renew before expiry.
    const TRIGGER_NON_RENEWAL: u8 = 0;
    /// Trigger fired because the vendor called `notify_eol`.
    const TRIGGER_MANUAL_EOL: u8  = 1;

    /// 48-hour grace period in seconds after an EOL notice.
    const GRACE_PERIOD_SECONDS: u64 = 172_800;

    // ─── Error codes ────────────────────────────────────────────────────────

    const E_NOT_VENDOR:          u64 = 1;
    const E_NOT_BUYER:           u64 = 2;
    const E_NOT_ACTIVE:          u64 = 3;
    const E_TRIGGER_NOT_MET:     u64 = 4;
    const E_ALREADY_TRIGGERED:   u64 = 5;
    const E_NOT_PENDING:         u64 = 6;
    const E_AGREEMENT_NOT_FOUND: u64 = 7;
    const E_EXPIRY_IN_PAST:      u64 = 8;
    const E_EOL_ALREADY_NOTICED: u64 = 9;

    // ─── Data structures ────────────────────────────────────────────────────

    struct EscrowAgreement has store {
        id: u64,
        vendor: address,
        buyer: address,

        /// Aptos address of the vendor's Shelby storage account.
        shelby_account: address,

        /// Shelby blob name for the latest committed deposit, e.g. "myapp/v1.2.3".
        blob_name: String,

        /// SHA-256 content Merkle root of the unencrypted source files,
        /// computed by the Covenant SDK before encryption.
        content_merkle_root: vector<u8>,

        /// Merkle root reported by Shelby for the stored blob (storage integrity).
        shelby_merkle_root: vector<u8>,

        /// Symmetric encryption key (AES-256-GCM), encrypted with the buyer's
        /// Aptos public key. Released to the buyer when a trigger fires.
        encrypted_key: vector<u8>,

        /// AES-GCM initialisation vector (12 bytes as hex). Released on trigger.
        iv: vector<u8>,

        /// AES-GCM authentication tag (16 bytes as hex). Released on trigger.
        auth_tag: vector<u8>,

        /// Unix seconds after which the non-renewal trigger becomes eligible.
        expiry_timestamp: u64,

        /// Unix seconds when the vendor called `notify_eol`. Zero if no notice.
        eol_notice_at: u64,

        /// Unix seconds when the trigger fired. Zero if not yet triggered.
        triggered_at: u64,

        state: u8,
        created_at: u64,
        last_commit_at: u64,
    }

    /// Singleton resource stored under the covenant module address.
    struct GlobalRegistry has key {
        agreements: Table<u64, EscrowAgreement>,
        next_id: u64,
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    #[event]
    struct AgreementCreated has drop, store {
        id: u64,
        vendor: address,
        buyer: address,
        expiry_timestamp: u64,
        created_at: u64,
    }

    #[event]
    struct AgreementAccepted has drop, store {
        id: u64,
        buyer: address,
        accepted_at: u64,
    }

    #[event]
    struct CommitRecorded has drop, store {
        id: u64,
        blob_name: String,
        content_merkle_root: vector<u8>,
        committed_at: u64,
    }

    #[event]
    struct AgreementRenewed has drop, store {
        id: u64,
        new_expiry_timestamp: u64,
        renewed_at: u64,
    }

    #[event]
    struct EOLNoticed has drop, store {
        id: u64,
        notice_at: u64,
        trigger_after: u64,
    }

    /// Emitted when a trigger fires. Contains everything the buyer needs to
    /// fetch and decrypt the source archive from Shelby.
    #[event]
    struct TriggerExecuted has drop, store {
        id: u64,
        trigger_type: u8,
        shelby_account: address,
        blob_name: String,
        content_merkle_root: vector<u8>,
        encrypted_key: vector<u8>,
        iv: vector<u8>,
        auth_tag: vector<u8>,
        executed_at: u64,
    }

    // ─── Initialisation ─────────────────────────────────────────────────────

    fun init_module(deployer: &signer) {
        move_to(deployer, GlobalRegistry {
            agreements: table::new(),
            next_id: 1,
        });
    }

    #[test_only]
    public fun init_module_for_test(deployer: &signer) {
        init_module(deployer);
    }

    // ─── Entry functions ─────────────────────────────────────────────────────

    /// Vendor creates a new escrow agreement (STATE_PENDING).
    /// The buyer must call `accept_agreement` to activate it.
    entry fun create_agreement(
        vendor: &signer,
        buyer: address,
        shelby_account: address,
        blob_name: String,
        content_merkle_root: vector<u8>,
        shelby_merkle_root: vector<u8>,
        encrypted_key: vector<u8>,
        iv: vector<u8>,
        auth_tag: vector<u8>,
        expiry_timestamp: u64,
    ) {
        let now = timestamp::now_seconds();
        assert!(expiry_timestamp > now, E_EXPIRY_IN_PAST);

        let registry = borrow_global_mut<GlobalRegistry>(@covenant);
        let id = registry.next_id;
        registry.next_id = id + 1;

        let agreement = EscrowAgreement {
            id,
            vendor: signer::address_of(vendor),
            buyer,
            shelby_account,
            blob_name,
            content_merkle_root,
            shelby_merkle_root,
            encrypted_key,
            iv,
            auth_tag,
            expiry_timestamp,
            eol_notice_at: 0,
            triggered_at: 0,
            state: STATE_PENDING,
            created_at: now,
            last_commit_at: now,
        };

        table::add(&mut registry.agreements, id, agreement);

        aptos_framework::event::emit(AgreementCreated {
            id,
            vendor: signer::address_of(vendor),
            buyer,
            expiry_timestamp,
            created_at: now,
        });
    }

    /// Buyer accepts the agreement, moving it to STATE_ACTIVE.
    entry fun accept_agreement(
        buyer: &signer,
        agreement_id: u64,
    ) {
        let registry = borrow_global_mut<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);

        let agreement = table::borrow_mut(&mut registry.agreements, agreement_id);
        assert!(agreement.state == STATE_PENDING, E_NOT_PENDING);
        assert!(signer::address_of(buyer) == agreement.buyer, E_NOT_BUYER);

        agreement.state = STATE_ACTIVE;
        let now = timestamp::now_seconds();

        aptos_framework::event::emit(AgreementAccepted {
            id: agreement_id,
            buyer: signer::address_of(buyer),
            accepted_at: now,
        });
    }

    /// Vendor records a new deposit after each code release.
    /// Updates the on-chain Merkle root, blob reference, and encryption params.
    entry fun record_commit(
        vendor: &signer,
        agreement_id: u64,
        blob_name: String,
        content_merkle_root: vector<u8>,
        shelby_merkle_root: vector<u8>,
        encrypted_key: vector<u8>,
        iv: vector<u8>,
        auth_tag: vector<u8>,
    ) {
        let registry = borrow_global_mut<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);

        let agreement = table::borrow_mut(&mut registry.agreements, agreement_id);
        assert!(signer::address_of(vendor) == agreement.vendor, E_NOT_VENDOR);
        assert!(agreement.state == STATE_ACTIVE, E_NOT_ACTIVE);

        let now = timestamp::now_seconds();
        agreement.blob_name          = blob_name;
        agreement.content_merkle_root = content_merkle_root;
        agreement.shelby_merkle_root  = shelby_merkle_root;
        agreement.encrypted_key       = encrypted_key;
        agreement.iv                  = iv;
        agreement.auth_tag            = auth_tag;
        agreement.last_commit_at      = now;

        aptos_framework::event::emit(CommitRecorded {
            id: agreement_id,
            blob_name: agreement.blob_name,
            content_merkle_root: agreement.content_merkle_root,
            committed_at: now,
        });
    }

    /// Vendor extends the agreement before it expires.
    /// New expiry must be strictly after the current one.
    entry fun renew(
        vendor: &signer,
        agreement_id: u64,
        new_expiry_timestamp: u64,
    ) {
        let registry = borrow_global_mut<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);

        let agreement = table::borrow_mut(&mut registry.agreements, agreement_id);
        assert!(signer::address_of(vendor) == agreement.vendor, E_NOT_VENDOR);
        assert!(agreement.state == STATE_ACTIVE, E_NOT_ACTIVE);
        assert!(new_expiry_timestamp > agreement.expiry_timestamp, E_EXPIRY_IN_PAST);

        agreement.expiry_timestamp = new_expiry_timestamp;
        let now = timestamp::now_seconds();

        aptos_framework::event::emit(AgreementRenewed {
            id: agreement_id,
            new_expiry_timestamp,
            renewed_at: now,
        });
    }

    /// Vendor signals end-of-life. Starts the 48h grace period after which
    /// anyone can call `execute_trigger` to release the code.
    entry fun notify_eol(
        vendor: &signer,
        agreement_id: u64,
    ) {
        let registry = borrow_global_mut<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);

        let agreement = table::borrow_mut(&mut registry.agreements, agreement_id);
        assert!(signer::address_of(vendor) == agreement.vendor, E_NOT_VENDOR);
        assert!(agreement.state == STATE_ACTIVE, E_NOT_ACTIVE);
        assert!(agreement.eol_notice_at == 0, E_EOL_ALREADY_NOTICED);

        let now = timestamp::now_seconds();
        agreement.eol_notice_at = now;

        aptos_framework::event::emit(EOLNoticed {
            id: agreement_id,
            notice_at: now,
            trigger_after: now + GRACE_PERIOD_SECONDS,
        });
    }

    /// Execute the trigger when a condition is met.
    /// Permissionless — anyone can call this once conditions are satisfied.
    /// This makes execution censorship-resistant.
    entry fun execute_trigger(
        _caller: &signer,
        agreement_id: u64,
    ) {
        let registry = borrow_global_mut<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);

        let agreement = table::borrow_mut(&mut registry.agreements, agreement_id);
        assert!(agreement.state == STATE_ACTIVE, E_NOT_ACTIVE);
        assert!(agreement.state != STATE_TRIGGERED, E_ALREADY_TRIGGERED);

        let now = timestamp::now_seconds();
        let (trigger_met, trigger_type) = check_trigger(agreement, now);
        assert!(trigger_met, E_TRIGGER_NOT_MET);

        agreement.state = STATE_TRIGGERED;
        agreement.triggered_at = now;

        aptos_framework::event::emit(TriggerExecuted {
            id: agreement_id,
            trigger_type,
            shelby_account:      agreement.shelby_account,
            blob_name:           agreement.blob_name,
            content_merkle_root: agreement.content_merkle_root,
            encrypted_key:       agreement.encrypted_key,
            iv:                  agreement.iv,
            auth_tag:            agreement.auth_tag,
            executed_at:         now,
        });
    }

    // ─── View functions ──────────────────────────────────────────────────────

    #[view]
    public fun get_state(agreement_id: u64): u8 {
        let registry = borrow_global<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);
        table::borrow(&registry.agreements, agreement_id).state
    }

    #[view]
    public fun get_content_merkle_root(agreement_id: u64): vector<u8> {
        let registry = borrow_global<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);
        table::borrow(&registry.agreements, agreement_id).content_merkle_root
    }

    /// Returns (expiry_timestamp, last_commit_at, eol_notice_at).
    #[view]
    public fun get_timestamps(agreement_id: u64): (u64, u64, u64) {
        let registry = borrow_global<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);
        let a = table::borrow(&registry.agreements, agreement_id);
        (a.expiry_timestamp, a.last_commit_at, a.eol_notice_at)
    }

    /// Returns true if a trigger condition is currently satisfied.
    #[view]
    public fun is_trigger_met(agreement_id: u64): bool {
        let registry = borrow_global<GlobalRegistry>(@covenant);
        assert!(table::contains(&registry.agreements, agreement_id), E_AGREEMENT_NOT_FOUND);
        let agreement = table::borrow(&registry.agreements, agreement_id);
        if (agreement.state != STATE_ACTIVE) { return false };
        let now = timestamp::now_seconds();
        let (met, _) = check_trigger(agreement, now);
        met
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    fun check_trigger(agreement: &EscrowAgreement, now: u64): (bool, u8) {
        if (agreement.eol_notice_at != 0
                && now >= agreement.eol_notice_at + GRACE_PERIOD_SECONDS) {
            return (true, TRIGGER_MANUAL_EOL)
        };
        if (now >= agreement.expiry_timestamp) {
            return (true, TRIGGER_NON_RENEWAL)
        };
        (false, 0)
    }
}
