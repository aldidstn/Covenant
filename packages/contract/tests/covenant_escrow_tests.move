#[test_only]
module covenant::escrow_tests {

    use std::string;
    use aptos_framework::timestamp;
    use aptos_framework::account;
    use covenant::escrow;

    // ─── Test helpers ────────────────────────────────────────────────────────

    const VENDOR_ADDR: address = @0xA;
    const BUYER_ADDR: address  = @0xB;
    const CALLER_ADDR: address = @0xC;

    fun setup_clock(aptos: &signer) {
        timestamp::set_time_has_started_for_testing(aptos);
    }

    fun dummy_bytes(): vector<u8> { b"deadbeef" }
    fun dummy_blob_name(): std::string::String { string::utf8(b"myapp/v1.0.0") }

    fun create_test_agreement(
        vendor: &signer,
        buyer_addr: address,
        expiry_offset_secs: u64,
    ) {
        let now = timestamp::now_seconds();
        escrow::create_agreement(
            vendor,
            buyer_addr,
            VENDOR_ADDR,
            dummy_blob_name(),
            dummy_bytes(),
            dummy_bytes(),
            dummy_bytes(),
            dummy_bytes(),
            dummy_bytes(),
            now + expiry_offset_secs,
        );
    }

    // ─── create_agreement ────────────────────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA)]
    fun test_create_agreement_ok(
        aptos: signer,
        covenant: signer,
        vendor: signer,
    ) {
        setup_clock(&aptos);
        // init_module is called automatically on publish; simulate here.
        escrow::init_module_for_test(&covenant);

        create_test_agreement(&vendor, BUYER_ADDR, 3600);

        // Agreement 1 should be PENDING (state 0).
        assert!(escrow::get_state(1) == 0, 0);
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA)]
    #[expected_failure(abort_code = 8)] // E_EXPIRY_IN_PAST
    fun test_create_agreement_expiry_in_past_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        // expiry_offset = 0 means expiry == now, which should fail.
        create_test_agreement(&vendor, BUYER_ADDR, 0);
    }

    // ─── accept_agreement ────────────────────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB)]
    fun test_accept_agreement_ok(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);

        escrow::accept_agreement(&buyer, 1);
        assert!(escrow::get_state(1) == 1, 0); // STATE_ACTIVE
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, caller = @0xC)]
    #[expected_failure(abort_code = 2)] // E_NOT_BUYER
    fun test_accept_agreement_wrong_buyer_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        caller: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        // caller is not the buyer
        escrow::accept_agreement(&caller, 1);
    }

    // ─── record_commit ───────────────────────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB)]
    fun test_record_commit_updates_merkle_root(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        escrow::accept_agreement(&buyer, 1);

        let new_root = b"new_merkle_root_bytes";
        escrow::record_commit(
            &vendor,
            1,
            string::utf8(b"myapp/v1.1.0"),
            new_root,
            dummy_bytes(),
            dummy_bytes(),
            dummy_bytes(),
            dummy_bytes(),
        );

        assert!(escrow::get_content_merkle_root(1) == new_root, 0);
    }

    // ─── renew ───────────────────────────────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB)]
    fun test_renew_extends_expiry(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        escrow::accept_agreement(&buyer, 1);

        let (old_expiry, _, _) = escrow::get_timestamps(1);
        escrow::renew(&vendor, 1, old_expiry + 7200);

        let (new_expiry, _, _) = escrow::get_timestamps(1);
        assert!(new_expiry == old_expiry + 7200, 0);
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB)]
    #[expected_failure(abort_code = 8)] // E_EXPIRY_IN_PAST (new <= old)
    fun test_renew_earlier_expiry_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        escrow::accept_agreement(&buyer, 1);
        let (old_expiry, _, _) = escrow::get_timestamps(1);
        escrow::renew(&vendor, 1, old_expiry - 1);
    }

    // ─── notify_eol ──────────────────────────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB)]
    fun test_notify_eol_sets_notice(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        escrow::accept_agreement(&buyer, 1);
        escrow::notify_eol(&vendor, 1);

        let (_, _, eol_notice_at) = escrow::get_timestamps(1);
        assert!(eol_notice_at > 0, 0);
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB)]
    #[expected_failure(abort_code = 9)] // E_EOL_ALREADY_NOTICED
    fun test_notify_eol_twice_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        escrow::accept_agreement(&buyer, 1);
        escrow::notify_eol(&vendor, 1);
        escrow::notify_eol(&vendor, 1); // should fail
    }

    // ─── execute_trigger — non-renewal ───────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB, caller = @0xC)]
    fun test_execute_trigger_non_renewal(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
        caller: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        // Agreement expires in 1 second.
        create_test_agreement(&vendor, BUYER_ADDR, 1);
        escrow::accept_agreement(&buyer, 1);

        // Advance time past the expiry.
        timestamp::fast_forward_seconds(2);

        assert!(escrow::is_trigger_met(1) == true, 0);
        escrow::execute_trigger(&caller, 1);
        assert!(escrow::get_state(1) == 2, 0); // STATE_TRIGGERED
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB, caller = @0xC)]
    #[expected_failure(abort_code = 4)] // E_TRIGGER_NOT_MET
    fun test_execute_trigger_before_expiry_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
        caller: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 3600);
        escrow::accept_agreement(&buyer, 1);
        // Do not advance time — trigger not met yet.
        escrow::execute_trigger(&caller, 1);
    }

    // ─── execute_trigger — manual EOL ────────────────────────────────────────

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB, caller = @0xC)]
    fun test_execute_trigger_after_eol_grace_period(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
        caller: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 999_999);
        escrow::accept_agreement(&buyer, 1);
        escrow::notify_eol(&vendor, 1);

        // Advance past the 48h grace period.
        timestamp::fast_forward_seconds(172_801);

        assert!(escrow::is_trigger_met(1) == true, 0);
        escrow::execute_trigger(&caller, 1);
        assert!(escrow::get_state(1) == 2, 0); // STATE_TRIGGERED
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB, caller = @0xC)]
    #[expected_failure(abort_code = 4)] // E_TRIGGER_NOT_MET — still in grace period
    fun test_execute_trigger_during_eol_grace_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
        caller: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 999_999);
        escrow::accept_agreement(&buyer, 1);
        escrow::notify_eol(&vendor, 1);

        // Only 1 hour into the 48h grace period.
        timestamp::fast_forward_seconds(3600);
        escrow::execute_trigger(&caller, 1);
    }

    #[test(aptos = @aptos_framework, covenant = @covenant, vendor = @0xA, buyer = @0xB, caller = @0xC)]
    #[expected_failure(abort_code = 5)] // E_ALREADY_TRIGGERED
    fun test_execute_trigger_twice_fails(
        aptos: signer,
        covenant: signer,
        vendor: signer,
        buyer: signer,
        caller: signer,
    ) {
        setup_clock(&aptos);
        escrow::init_module_for_test(&covenant);
        create_test_agreement(&vendor, BUYER_ADDR, 1);
        escrow::accept_agreement(&buyer, 1);
        timestamp::fast_forward_seconds(2);
        escrow::execute_trigger(&caller, 1);
        escrow::execute_trigger(&caller, 1); // second call must fail
    }
}
