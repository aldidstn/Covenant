# Covenant

> Continuous, cryptographic software escrow. One GitHub Action to seal your code. Smart contracts handle the rest.

[![License: MIT](https://img.shields.io/badge/License-MIT-gray.svg)](LICENSE)
[![Built on Shelby](https://img.shields.io/badge/Storage-Shelby_Protocol-534AB7)](https://shelby.xyz)
[![Settled on Aptos](https://img.shields.io/badge/Settlement-Aptos_L1-1D9E75)](https://aptoslabs.com)
[![Status: Testnet](https://img.shields.io/badge/Status-Testnet-FAEEDA?labelColor=633806&color=FAEEDA)](https://docs.getcovenant.dev)

---

## What is Covenant?

Covenant is a decentralized software escrow platform. It lets software vendors continuously commit their source code to [Shelby Protocol](https://shelby.xyz) — a high-performance decentralized blob storage network — and anchor a cryptographic proof of that commitment on the Aptos blockchain.

When a trigger condition fires (bankruptcy, acquisition, non-renewal, SLA breach), an Aptos smart contract automatically releases a read key to the buyer's wallet. No intermediary. No lawyers. No delay.

```bash
# Add to your CI pipeline. That's it.
- name: Seal release
  uses: covenant-dev/covenant-action@v1
  with:
    token: ${{ secrets.COVENANT_TOKEN }}
    tag: ${{ github.ref_name }}
```

Every tagged release is sealed on Shelby and anchored on Aptos within minutes. Your buyers can verify the deposit is real and current — any time, without asking you.

---

## Why Covenant?

### The problem with traditional software escrow

If the SaaS you depend on shuts down tomorrow and you never held the source code, you're stranded. Software escrow exists to solve this — but the industry's solution is broken in three fundamental ways.

**Deposits go stale.** Vendors deposit code once at contract signing and never update it. What a buyer receives when a trigger fires is often months or years behind the live product — too old to be useful.

**Nothing is verifiable.** Buyers have no way to confirm what was actually deposited. An escrow agent might hold an outdated folder, an empty archive, or nothing at all. There is no cryptographic proof of contents.

**Triggers become legal disputes.** Release conditions are written in paper contracts. Every trigger event — a bankruptcy, an acquisition, a missed renewal — becomes a negotiation. The protection that was supposed to be automatic takes months of legal fees to enforce.

Traditional escrow protects no one. It creates the *appearance* of protection.

---

### How Covenant fixes this

Covenant replaces trust in a middleman with trust in mathematics.

**Continuous deposits.** Every time you cut a release, the Covenant GitHub Action seals your source code to Shelby automatically. Your buyers always have access to the latest committed version — not a snapshot from a year ago.

**Cryptographic proof.** Every commit produces a Merkle root anchored on Aptos L1 before your CI pipeline moves on. The proof is public, permanent, and independent of Covenant as a company. If we disappear, the proof remains.

**Smart contract triggers.** Release conditions are code, not prose. When a condition is met — your company files for bankruptcy, misses a renewal, or calls `notifyEOL()` — the smart contract executes and releases the read key to the buyer's wallet. No humans required.

**Self-serve verification.** Buyers can query the deposit anytime from the Covenant portal. Upload any file, receive a binary proof of inclusion or exclusion against the current Merkle root. No escrow agent to call, no access request to file.

---

### Why decentralized storage?

We built on [Shelby Protocol](https://shelby.xyz) specifically because of how it stores data.

Shelby distributes every blob across 16 independent storage providers using erasure coding. No single provider holds the complete code — which means no government, no acquirer, and no Covenant employee can unilaterally delete or alter a deposit. The data is redundant by design.

Every write commits a Merkle root to Aptos L1, giving any party — vendor, buyer, regulator, or auditor — the ability to independently verify data integrity without trusting Covenant, Shelby, or anyone else.

---

### What Covenant does not do

- We never read your source code. All blobs are encrypted client-side before transmission.
- We are not a party to your escrow agreement. The smart contract is between vendor and buyer.
- We cannot alter, delay, or block a trigger once conditions are met.
- We do not replace legal counsel. Covenant is infrastructure, not legal advice.

---

## How it works

```
Vendor CI pipeline
      │
      ▼
covenant seal (GitHub Action)
      │
      ├──► Shelby Protocol ──► Encrypted blob stored across 16 providers
      │
      └──► Aptos L1 ──────────► Merkle root committed on-chain
                                        │
                               Trigger oracle monitors conditions
                                        │
                               Condition met → smart contract fires
                                        │
                               Buyer wallet ◄── Read key released
                                        │
                               Buyer reads full source from Shelby
```

---

## Quick start

```bash
npm install -g @covenant-dev/cli

covenant auth login
covenant init
covenant seal --tag v1.0.0
```

Full documentation → [docs.getcovenant.dev](https://docs.getcovenant.dev)

---

## Status

Covenant is currently on **testnet**. Mainnet launch is gated on Shelby Protocol's production readiness.

| Component | Status |
|---|---|
| Shelby SDK wrapper | ✅ Testnet |
| GitHub Action | ✅ Testnet |
| Aptos escrow contract | ✅ Testnet (audit pending) |
| Vendor dashboard | 🔧 In progress |
| Buyer verification portal | 🔧 In progress |
| Trigger oracle (non-renewal) | 📅 Q3 2026 |
| Trigger oracle (bankruptcy) | 📅 Q4 2026 |

---

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">Built on <a href="https://shelby.xyz">Shelby Protocol</a> · Settled on <a href="https://aptoslabs.com">Aptos</a></p>
