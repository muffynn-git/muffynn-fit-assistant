# Muffynn AI Size & Fit Assistant

A lightweight, decoupled AI size/fit recommendation widget for the Muffynn.com
Shopify store. Deterministic sizing engine as source of truth; an LLM is an
**optional** interpretation layer only.

## 1. Architecture

```
SHOPIFY PDP
   │ async lightweight JS
   ▼
FIT WIDGET (public/muffynn-fit.js)
   │ user interaction only (no call on load)
   ▼
VERCEL SERVERLESS API (api/recommend-size.js)
   ├── validation (lib/validation.js)
   ├── deterministic sizing (lib/sizing-engine.js)
   └── optional LLM (<=1400ms timeout, never overrides size)
          ▼
      JSON result
          ▼
SHOPIFY EXISTING VARIANT SYSTEM
```

No database. No Google Sheets. No Supabase/Firebase. No paid backend beyond
Vercel itself. All secrets (LLM API keys) live only in Vercel environment
variables — never in Shopify/Liquid/theme JS.

## 2. Repository structure

```
muffynn-fit-assistant/
├── api/recommend-size.js     Vercel serverless function
├── lib/sizing-engine.js      Deterministic sizing engine (source of truth)
├── lib/validation.js         Centralized request validation
├── public/muffynn-fit.js     Client widget (vanilla JS, zero deps)
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

## 3. Local installation

```bash
git clone <your-repo-url>
cd muffynn-fit-assistant
npm install
cp .env.example .env.local
```

## 4. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `LLM_PROVIDER` | No (defaults to `none`) | `none`, `openai`, or `anthropic` |
| `OPENAI_API_KEY` | Only if `LLM_PROVIDER=openai` | OpenAI secret key |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Only if `LLM_PROVIDER=anthropic` | Anthropic secret key |

The **zero-external-API-cost configuration** is `LLM_PROVIDER=none`. The
deterministic engine remains fully functional in this mode.

## 5. Local development

```bash
npm run dev
```

This uses the Vercel CLI (`vercel dev`) to run the serverless function and
static assets locally. Install the CLI globally if you don't have it:
`npm i -g vercel`.

## 6. Vercel deployment

1. Push this repository to GitHub.
2. Go to vercel.com → **Add New Project** → import the GitHub repo.
3. In **Settings → Environment Variables**, add the variables from section 4.
4. Deploy.
5. Note your deployment URL, e.g. `https://muffynn-fit-assistant.vercel.app`.
6. Test the API and the static JS file directly (see section 8).
7. Once confirmed working, add the production domain and update
   `CONFIG.apiUrl` in `public/muffynn-fit.js` (or serve it dynamically —
   see Deliverable C notes below) and the `src` in the Shopify Liquid
   snippet to point at this deployment.

## 7. Shopify integration

Verified directly against the `muffynn-com-muffynn_prod_live` theme export
(22 Aug 2026). This is a Shopify Horizon-family theme.

### What the theme actually looks like

- PDP render path: `sections/main-product.liquid` → `snippets/product-info.liquid`
  → `snippets/product-form.liquid` (loops `section.blocks`; the default block
  order in both `templates/product.json` and `templates/product.flexiwaist.json`
  is `variant_picker` → `buy_buttons`).
- The size selector renders inside a `<variant-picker>` custom element
  (`snippets/product-form.liquid`), with a `.product-form__option-selector`
  per option, an option-name label in `.product-form__option-name`, and
  values as radios (`input[type=radio][data-option-position]`), a
  `<select data-option-position>`, or `[role="option"]` buttons depending on
  the merchant's chosen selector style (block/swatch/dropdown).
- The theme **already ships** `assets/size-memory.js`, which remembers the
  shopper's last-picked size and re-applies it via exactly this mechanism —
  find the size option by name, match the value's label text, check/select
  it, then dispatch a bubbling `change` event so the theme's own
  `<variant-picker>` element (`assets/theme.js`, `onOptionChanged_fn`) picks
  it up. `applySizeToVariant()` in `public/muffynn-fit.js` reuses this exact,
  already-proven pattern rather than inventing a new one.
- **Worth knowing:** the theme also has a separate size-guide integration —
  Kiwi Sizing (`sections/product-app-size-guide.liquid`, loaded via
  `ks.loadSizing(...)`) — but it only runs on a distinct, non-default
  `product.appbrew-size-guide` template/layout, not the standard PDP. It
  should not collide with this widget, but flagging it in case Muffynn wants
  the two systems reconciled or one retired later.
- `templates/product.flexiwaist.json` and `templates/product.flexiplus.json`
  independently confirm the height-based Flexiwaist/Flexiplus split used in
  Rule 4 (Flexiwaist = ankle fit, "up to 5'10\""; Flexiplus = straight fit,
  "above 5'10\"" ≈ your 178 cm threshold).
- The variant_picker block's own settings already reference
  `product.metafields.custom.size_chart.value` as a size-chart **page**
  link. That page's actual waist/chest numbers are Shopify admin content,
  not theme files, so they weren't in this export —
  **`REQUIRES CONFIGURATION`** still applies to `SIZE_CHARTS` in
  `lib/sizing-engine.js`. Pull the real numbers from that page (or wherever
  Muffynn keeps them) before deploying.
- `sections/quiz.liquid` is a separate, pre-existing "style quiz" landing
  page that filters products by `metafields.custom.fit` /
  `metafields.custom.height_fit` / `metafields.custom.occassion` — this
  helps you pick **which product** to feature, not **which size** of a
  given product, so it's a different feature from this size assistant. Its
  real fit values (`straight-fit`, `ankle-fit`) could be a useful reference
  if you want to later tune `CATEGORY_KEYWORDS` / product-line keyword
  matching in `lib/sizing-engine.js`.

### Applied changes

Two files were edited. Both patches are included in this package under
`shopify-integration/`: `product-form.liquid.patch`, `theme.liquid.patch`,
and the full modified files (`*.modified`) for direct copy-paste.

#### Change 1 — reserved container + product data

| Field | Value |
|---|---|
| File | `snippets/product-form.liquid` |
| Section | Inside the `{%- when 'variant_picker' -%}` block, immediately after the closing `</variant-picker>` tag and before that block's `{%- endunless -%}` |
| Reason | Mounting inside the `variant_picker` block's own template (rather than depending on `section.blocks` order) guarantees the widget always renders directly after the size selector and before Add to Cart, even if a merchant reorders blocks in the theme editor. A fixed `min-height: 56px` on the container prevents layout shift before the JS populates it. |
| Risk | Purely additive markup; does not touch the `<variant-picker>` element, its inputs, or the buy-buttons block. Only renders when the product has more than the default variant (same condition already guarding the existing size selector). |
| Rollback | Remove the added `<div id="muffynn-fit-root" ...>` and the following `<script id="muffynn-fit-product-data">` block — see `product-form.liquid.patch`. |

#### Change 2 — PDP-only async script load

| Field | Value |
|---|---|
| File | `layout/theme.liquid` |
| Section | Immediately after the existing `<script src="{{ 'size-memory.js' | asset_url }}" defer></script>` line, guarded by `{%- if request.page_type == 'product' -%}` |
| Reason | Loads `muffynn-fit.js` only on PDPs, async + defer, matching the pattern the theme already uses for its own PDP-only assets (e.g. the `photoswipe-custom.min.css` preload a few lines above). |
| Risk | None to other pages — script tag is skipped entirely outside `request.page_type == 'product'`. Does not touch cart, checkout, or any other script. |
| Rollback | Remove the added `{%- if request.page_type == 'product' -%} ... {%- endif -%}` block — see `theme.liquid.patch`. |

Before deploying, replace `https://YOUR-VERCEL-DOMAIN.vercel.app` in
`theme.liquid.modified` (and in `public/muffynn-fit.js`'s `CONFIG.apiUrl`)
with your actual Vercel deployment URL.

## 8. API testing

```bash
curl -X POST https://YOUR-VERCEL-DOMAIN.vercel.app/api/recommend-size \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "123",
    "product_type": "Trousers",
    "product_title": "Flexiwaist Formal Pants",
    "waist_inches": 32,
    "fit_preference": "formal office wear",
    "session_id": "mf_test_12345"
  }'
```

Also test: invalid JSON, empty body, wrong HTTP method, oversized body,
out-of-range waist/chest/height/weight, missing product data, and (if an LLM
provider is configured) a slow/failing LLM response to confirm the API still
returns the deterministic result within a reasonable time.

## 9. Logs

Vercel dashboard → your project → **Deployments** → select a deployment →
**Functions** tab shows invocation logs, duration, and errors for
`api/recommend-size`.

## 10. Preview deployments

Every pull request / non-production branch pushed to GitHub gets its own
preview URL automatically from Vercel — use these to test changes before
merging to production.

## 11. Production deployments

Merging to the production branch (commonly `main`) triggers a production
deployment automatically once the GitHub integration is connected.

## 12. Rollbacks

Vercel dashboard → **Deployments** → find a previous working deployment →
**Promote to Production**. No code changes required.

## 13. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Widget never appears | `data-muffynn-fit-root` container missing, or product data JSON missing/invalid |
| CORS error in console | Origin isn't `https://muffynn.com` / `https://www.muffynn.com`, or testing from a different preview domain |
| Recommendation always fails | `product_type`/`product_title` don't match the keyword-based category detection — see `CATEGORY_KEYWORDS` in `lib/sizing-engine.js` |
| Apply Size doesn't select a variant | The real theme's variant selector doesn't match the placeholder logic in `applySizeToVariant()` — **REQUIRES THEME INSPECTION** |

## 14. Performance testing

Compare **assistant OFF** vs **assistant ON** using:
- Chrome DevTools (Network, Performance, Coverage panels)
- Lighthouse (LCP, CLS, INP, Performance score, total JS, request count)
- PageSpeed Insights against the live production PDP
- `gzip -c public/muffynn-fit.js | wc -c` to confirm bundle size

Current measured size: the minified widget gzips to roughly 2.9 KB, well
under the 15 KB target — but re-measure after any changes.

## 15. Security

- All LLM API keys live only in Vercel environment variables.
- CORS is restricted to `https://muffynn.com` and `https://www.muffynn.com`.
- All inputs are validated server-side regardless of client-side checks.
- `fit_preference` and `fit_notes` are length-capped before ever reaching
  an LLM call.
- No stack traces, keys, or infrastructure details are ever returned in API
  responses.
- Client-side submission cooldown is a UX nicety, **not** a security
  boundary — see the note in section 16.

## 16. Cost & rate-limiting limitations

**Free infrastructure (potentially):** Vercel hosting, Vercel serverless
function execution within plan limits, GitHub, Shopify theme integration,
GA4/`dataLayer`.

**Potential external cost (only if enabled):** OpenAI API, Anthropic API —
these are paid services and are not part of the free configuration.

> The architecture has no mandatory paid infrastructure. It can run within
> Vercel's applicable free-plan limits for reasonable traffic, but Vercel
> plan limits and pricing can change, and high traffic may require a paid
> plan.

**Rate limiting is intentionally lightweight** for the free/stateless
version: no Redis, no external rate-limit service. The API relies on
client-triggered-only requests, a short client-side cooldown, and payload
validation. This is **not** a complete abuse-prevention boundary — a
determined bad actor can still send many requests directly to the API
endpoint. If abuse becomes a real problem, consider Vercel's built-in
platform protections or a proper rate-limiting service as a paid,
explicitly-opted-into upgrade — do not assume the current setup blocks
scripted abuse.
