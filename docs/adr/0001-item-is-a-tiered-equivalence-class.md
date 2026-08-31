# Item is a tiered equivalence class, not an exact barcode match

Comparing grocery prices across Chains requires deciding when two Products are "the same thing." Exact UPC matching is provably correct but useless here: store brands (Kroger, Great Value, Kirkland, WinCo, Good & Gather) share no barcode with each other, and they are precisely where the price differences live — an exact-match app would compare name-brand packaged goods only and would report Smith's Fairlife at $4.79 as "the cheapest milk" while a $2.98 gallon sat unmatched at WinCo.

We therefore model **Item** as a cross-store equivalence class that many **Products** map into, and accept inferred matching as a first-class mechanism rather than an error case. Matching runs a confidence ladder — shared UPC (High), normalized brand/size/category (Medium), else Unmatched and surfaced as a candidate — and **Match confidence is always shown in the UI**, so a Medium match is presented as a claim the user can reject. Every user correction becomes a **Pinned match**: permanent ground truth that overrides the matcher and is never re-derived.

## Considered options

- **Exact UPC only** — rejected. Zero false positives, but it deletes store brands from the comparison and so fails the product's core promise.
- **Fully manual, user-pinned Items** — rejected as the *primary* model (~30–60s of setup per item makes a 40-item staples list an onboarding wall), but retained as the correction mechanism and as the bootstrap path from receipt import.

## Consequences

- False matches are possible by design. This is only acceptable because confidence is visible and correction is one click; if either is ever dropped, this decision becomes indefensible.
- Pinned matches are user data, not derived data. They must survive re-matching, provider changes, and schema migrations — losing them silently degrades an app the user has invested in.
- Pack multiple must be modelled from day one, or Costco's 2-gallon pack either wins comparisons it shouldn't or gets excluded from ones it should.
