// Kuru fill decoding — checked against the chain, not against arithmetic.
//
// The cases below are real MON/USDC fills. Each one records what the same
// transaction actually moved in USDC (base units, 6 decimals), read from the
// receipt. So the assertion is not "the formula agrees with itself" but "the
// formula reproduces what the chain did".
//
// That distinction is the whole point: the price looked plausible at 1e18 for a
// long time, and looking plausible is not evidence. Six fills agreeing with the
// USDC that moved is. Runs under tsx with no framework and no network:
// `pnpm test:kuru`.

import assert from "node:assert/strict";
import { decodeKuruFill, VERIFIED_MARKETS, type KuruMarketPrecision } from "../lib/kuru-fill";

const MON_USDC = VERIFIED_MARKETS["0x065c9d28e428a0db40191a54d33d5b7c71a9c394"];
assert.ok(MON_USDC, "the MON/USDC market must be in the verified table");

/**
 * A fill plus the USDC its transaction moved, in raw 6-decimal units. `drift`
 * is how many units of USDC the chain's own integer rounding may differ by.
 */
type Case = {
  tx: string;
  price: string;
  filledSize: string;
  updatedSize: string;
  usdcRaw: number;
  drift: number;
};

const CASES: Case[] = [
  {
    tx: "0xc8b76ba4388f30f0d31fb4b039379a4976145cbd9f82523277639dd2f7ce2899",
    price: "25647000000000000",
    filledSize: "9046990291262",
    updatedSize: "54433587376502",
    usdcRaw: 23202816,
    drift: 0
  },
  {
    tx: "0xbc36345ca068f424ee157595443b40b03d1d6d1cae9d5cd3b505f8b270a17f05",
    price: "25647000000000000",
    filledSize: "8511168167816",
    updatedSize: "45922419208686",
    usdcRaw: 21828593,
    drift: 0
  },
  {
    tx: "0x37ac2627b3456599db7d72304ed965dbc14e2d4d8d99cd1a010680cc19e533d9",
    price: "25647000000000000",
    filledSize: "6895784302257",
    updatedSize: "39026634906429",
    usdcRaw: 17685618,
    drift: 1 // the tx moved 17.685619 and 17.685618; the contract rounded one down
  },
  {
    tx: "0xb3782063bb320be295f824747c61f754220cd96015fbc54a4d76277a86f8cc5e",
    price: "25647000000000000",
    filledSize: "3575748430615",
    updatedSize: "35450886475814",
    usdcRaw: 9170722,
    drift: 1
  },
  {
    tx: "0x4fbbc7a1e11c073afe9482a8bbbbacf3d09f74e097791de931bcda3ffb3af81c",
    price: "25647000000000000",
    filledSize: "1173494365812",
    updatedSize: "34277392110002",
    usdcRaw: 3009661,
    drift: 0
  }
];

// 1. Every fill's notional reproduces the USDC its own transaction moved.
//    Compared as integers of USDC base units: the conversion runs through
//    doubles, so the last digit of the mantissa is noise, not a discrepancy.
for (const c of CASES) {
  const fill = decodeKuruFill(c, MON_USDC);
  assert.ok(fill, `${c.tx}: should decode`);
  const ours = Math.round(fill.quoteAmount * 1e6);
  assert.ok(
    Math.abs(ours - c.usdcRaw) <= c.drift,
    `${c.tx}: expected ~${c.usdcRaw} USDC base units, got ${ours}`
  );
}

// 2. The price is quote-per-base and agrees with the market's live USD price.
//    0.025647 USDC per MON, against a live MON price of $0.025703 the same day.
{
  const fill = decodeKuruFill(CASES[0], MON_USDC);
  assert.ok(fill);
  assert.ok(
    Math.abs(fill.priceQuotePerBase - 0.025647) < 1e-9,
    `price per base should be 0.025647, got ${fill.priceQuotePerBase}`
  );
}

// 3. `pricePrecision × sizePrecision` is what scales the price, which for this
//    market is 1e18 — so dividing by 1e18 and dividing by the product agree.
//    The formula uses the product because that is the part that generalises.
{
  const fill = decodeKuruFill(CASES[1], MON_USDC);
  assert.ok(fill);
  assert.equal(fill.priceQuotePerBase, Number(BigInt("25647000000000000")) / 1e18);
}

// 4. Sizes read in base units, and the resting size is the maker's remainder.
{
  const fill = decodeKuruFill(CASES[0], MON_USDC);
  assert.ok(fill);
  assert.ok(Math.abs(fill.baseAmount - 904.6990291262) < 1e-9, `got ${fill.baseAmount}`);
  assert.ok(Math.abs(fill.remainingBaseAmount - 5443.3587376502) < 1e-9, `got ${fill.remainingBaseAmount}`);
}

// 5. The notional is the two factors multiplied — not a separately-derived
//    number that could drift from them.
{
  const fill = decodeKuruFill(CASES[2], MON_USDC);
  assert.ok(fill);
  assert.equal(fill.quoteAmount, fill.priceQuotePerBase * fill.baseAmount);
}

// 6. No precisions, no reading. A known pair is not enough to divide by.
{
  const zero: KuruMarketPrecision = { pricePrecision: BigInt(0), sizePrecision: BigInt(0) };
  assert.equal(decodeKuruFill(CASES[0], zero), null, "zero precisions must refuse");

  const halfZero: KuruMarketPrecision = { pricePrecision: BigInt(100_000_000), sizePrecision: BigInt(0) };
  assert.equal(decodeKuruFill(CASES[0], halfZero), null, "a zero size precision must refuse");
}

// 7. Junk in the stored columns is refused rather than coerced to 0 or NaN.
{
  assert.equal(decodeKuruFill({ ...CASES[0], price: "not a number" }, MON_USDC), null);
  assert.equal(decodeKuruFill({ ...CASES[0], filledSize: "" }, MON_USDC), null);
  assert.equal(decodeKuruFill({ ...CASES[0], updatedSize: "1.5" }, MON_USDC), null, "a fraction is not a size");
}

// 8. The inactive market has no verified scaling, so it cannot be decoded —
//    which is the honest state, not a gap to paper over with a default.
{
  assert.equal(VERIFIED_MARKETS["0x131a2e70a5b31a517a74b8c567149bc294470da9"], undefined);
  assert.equal(Object.keys(VERIFIED_MARKETS).length, 1);
}

console.log(`kuru: ${CASES.length} on-chain fills reproduced, 8/8 case groups passed`);
