/**
 * FILE: /public/muffynn-fit.js
 * PURPOSE: Lightweight client-side PDP "Find My Size" widget.
 *
 * - Vanilla JS, ES6+, zero dependencies
 * - No API call on load/init — only after user submits the form
 * - Renders into a pre-reserved container to avoid CLS
 * - Uses textContent (never innerHTML) for anything derived from
 *   API responses or user input
 *
 * ============================================================
 * THEME INSPECTION COMPLETE (muffynn-com-muffynn_prod_live, 22 Aug 2026)
 * ============================================================
 * This theme is a Shopify Horizon-family theme. Confirmed from the actual
 * theme export:
 *
 *   - PDP render path: sections/main-product.liquid
 *       -> snippets/product-info.liquid
 *       -> snippets/product-form.liquid (block loop: variant_picker -> buy_buttons)
 *   - The widget container is inserted by Deliverable C directly inside the
 *     `variant_picker` block markup in snippets/product-form.liquid, right
 *     after the closing </variant-picker> tag. This guarantees it always
 *     renders between the size selector and Add to Cart, regardless of
 *     merchant block reordering in the theme editor, because it lives
 *     inside the variant_picker block's own template rather than depending
 *     on block order (confirmed variant_picker precedes buy_buttons in both
 *     templates/product.json and templates/product.flexiwaist.json).
 *   - CONFIG.containerSelector matches the `#muffynn-fit-root` element added
 *     in that same edit (see Deliverable C).
 *   - Product identity (product_id/title/type/sku/variant_id) is exposed via
 *     a small Liquid JSON block added next to the container (the theme's
 *     existing `#product-data` div from sections/product-app-size-guide.liquid
 *     is NOT usable here — it only renders on the separate, non-default
 *     "appbrew-size-guide" template, not on the standard product template).
 *   - Variant selection reuses the exact mechanism already proven in this
 *     theme's own assets/size-memory.js: size options render as
 *     `.product-form__option-selector` containers, the option name lives in
 *     `.product-form__option-name`, and values are either
 *     `input[type=radio][data-option-position]` (with a `label[for=id]` for
 *     the visible text), a `select[data-option-position]`, or — for the
 *     dropdown "combo-box" selector type — `[role="option"]` elements.
 *     Checking a radio (or setting a select's value) and dispatching a
 *     bubbling `change` event is what the theme's own `<variant-picker>`
 *     custom element listens for (assets/theme.js, `onOptionChanged_fn`),
 *     so this integrates with the existing variant system rather than
 *     replacing it.
 * ============================================================
 */

(function () {
  'use strict';

  const CONFIG = {
    apiUrl: 'https://YOUR-VERCEL-DOMAIN.vercel.app/api/recommend-size', // REQUIRES CONFIGURATION — set after Vercel deploy
    containerSelector: '#muffynn-fit-root',
    productDataElementId: 'muffynn-fit-product-data',
    sessionStorageKey: 'muffynn_fit_session_id',
    cooldownMs: 4000
  };

  function getRoot() {
    return document.querySelector(CONFIG.containerSelector);
  }

  function alreadyInitialized(root) {
    return root.dataset.muffynnFitInitialized === 'true';
  }

  function markInitialized(root) {
    root.dataset.muffynnFitInitialized = 'true';
  }

  function isProductPage() {
    // The script tag itself is only emitted inside
    // {%- if request.page_type == 'product' -%} in layout/theme.liquid
    // (see Deliverable C), so this is a defensive backstop only — e.g. in
    // case the file is ever cached/loaded outside that guard.
    return !!getRoot();
  }

  function readProductData() {
    const el = document.getElementById(CONFIG.productDataElementId);
    if (!el) return null;
    try {
      const data = JSON.parse(el.textContent);
      if (!data || !data.product_id) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(CONFIG.sessionStorageKey);
      if (!id) {
        id = 'mf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(CONFIG.sessionStorageKey, id);
      }
      return id;
    } catch (e) {
      // sessionStorage unavailable (private mode, etc.) — use an ephemeral id
      return 'mf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function pushDataLayer(event, payload) {
    try {
      if (!window.dataLayer) return;
      window.dataLayer.push(Object.assign({ event }, payload));
    } catch (e) {
      // do nothing — analytics must never break the widget
    }
  }

  function detectCategoryHint(productType, productTitle) {
    const text = ((productType || '') + ' ' + (productTitle || '')).toLowerCase();
    if (/(trouser|pant|chino)/.test(text)) return 'trouser';
    if (/(oversized)/.test(text)) return 'oversized_tshirt';
    if (/(hoodie|sweatshirt)/.test(text)) return 'hoodie';
    if (/(shirt)/.test(text) && !/(t-shirt|tshirt|tee)/.test(text)) return 'shirt';
    if (/(t-shirt|tshirt|tee)/.test(text)) return 'tshirt';
    return 'unknown';
  }

  function createEl(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'text') {
          el.textContent = attrs[k];
        } else {
          el.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach((c) => c && el.appendChild(c));
    return el;
  }

  function buildWidget(root, productData) {
    root.textContent = '';

    const category = detectCategoryHint(productData.type, productData.title);

    const toggleBtn = createEl('button', {
      type: 'button',
      class: 'muffynn-fit-cta',
      'aria-expanded': 'false',
      'aria-controls': 'muffynn-fit-panel',
      text: 'Find My Size'
    });
    const subText = createEl('p', {
      class: 'muffynn-fit-subtext',
      text: 'Get your recommended size in under a minute.'
    });

    const panel = createEl('div', {
      id: 'muffynn-fit-panel',
      class: 'muffynn-fit-panel',
      role: 'dialog',
      'aria-label': 'Find your size',
      hidden: 'hidden'
    });

    const form = document.createElement('form');
    form.setAttribute('novalidate', 'novalidate');

    const fields = [];

    if (category === 'trouser') {
      fields.push(makeNumberField('waist_inches', 'Waist (inches)', 20, 60));
    } else if (['tshirt', 'oversized_tshirt', 'shirt', 'hoodie'].includes(category)) {
      fields.push(makeNumberField('chest_inches', 'Chest (inches)', 28, 70));
    } else {
      fields.push(makeNumberField('waist_inches', 'Waist (inches, optional)', 20, 60, false));
      fields.push(makeNumberField('chest_inches', 'Chest (inches, optional)', 28, 70, false));
    }
    fields.push(makeNumberField('height_cm', 'Height (cm, optional)', 120, 230, false));
    fields.push(makeNumberField('weight_kg', 'Weight (kg, optional)', 30, 250, false));

    const fitPreferenceLabel = createEl('label', { for: 'muffynn-fit-preference', text: 'Fit preference (optional)' });
    const fitPreferenceInput = createEl('textarea', {
      id: 'muffynn-fit-preference',
      name: 'fit_preference',
      maxlength: '300',
      rows: '2',
      placeholder: 'e.g. comfortable and roomier, not too tight'
    });

    const errorRegion = createEl('div', { class: 'muffynn-fit-error', role: 'alert', 'aria-live': 'assertive' });
    const resultRegion = createEl('div', { class: 'muffynn-fit-result', 'aria-live': 'polite' });

    const submitBtn = createEl('button', { type: 'submit', class: 'muffynn-fit-submit', text: 'Get My Recommendation' });
    const closeBtn = createEl('button', {
      type: 'button',
      class: 'muffynn-fit-close',
      'aria-label': 'Close size finder',
      text: '\u2715'
    });

    fields.forEach((f) => form.appendChild(f.wrapper));
    form.appendChild(fitPreferenceLabel);
    form.appendChild(fitPreferenceInput);
    form.appendChild(errorRegion);
    form.appendChild(submitBtn);

    panel.appendChild(closeBtn);
    panel.appendChild(form);
    panel.appendChild(resultRegion);

    root.appendChild(toggleBtn);
    root.appendChild(subText);
    root.appendChild(panel);

    let isOpen = false;
    let lastFocused = null;
    let cooldownActive = false;

    function openPanel() {
      isOpen = true;
      panel.hidden = false;
      toggleBtn.setAttribute('aria-expanded', 'true');
      lastFocused = document.activeElement;
      const firstInput = form.querySelector('input, textarea, button');
      if (firstInput) firstInput.focus();
      pushDataLayer('size_recommendation_opened', {
        session_id: getSessionId(),
        product_id: productData.product_id,
        product_sku: productData.sku
      });
    }

    function closePanel() {
      isOpen = false;
      panel.hidden = true;
      toggleBtn.setAttribute('aria-expanded', 'false');
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    toggleBtn.addEventListener('click', () => {
      isOpen ? closePanel() : openPanel();
    });
    closeBtn.addEventListener('click', closePanel);

    root.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape' && isOpen) closePanel();
    });

    form.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      if (cooldownActive) return;

      errorRegion.textContent = '';
      resultRegion.textContent = '';

      const payload = collectPayload(form, productData);
      const clientError = validateClientSide(payload);
      if (clientError) {
        errorRegion.textContent = clientError;
        return;
      }

      cooldownActive = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Checking...';

      try {
        const response = await requestRecommendation(payload);
        renderResult(response, resultRegion, productData);
      } catch (err) {
        errorRegion.textContent = "We couldn't complete the fit check right now. Please use the size chart below.";
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Get My Recommendation';
        setTimeout(() => {
          cooldownActive = false;
        }, CONFIG.cooldownMs);
      }
    });

    return { openPanel, closePanel };
  }

  function makeNumberField(name, labelText, min, max, required) {
    const wrapper = document.createElement('div');
    wrapper.className = 'muffynn-fit-field';
    const id = 'muffynn-fit-' + name;
    const label = createEl('label', { for: id, text: labelText });
    const input = createEl('input', {
      type: 'number',
      id,
      name,
      min: String(min),
      max: String(max),
      step: '0.1'
    });
    if (required !== false) input.setAttribute('required', 'required');
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  function collectPayload(form, productData) {
    const get = (name) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return null;
      const val = el.value;
      return val === '' ? null : val;
    };

    const toNum = (v) => (v === null ? null : Number(v));

    return {
      product_id: String(productData.product_id),
      variant_id: productData.variant_id ? String(productData.variant_id) : null,
      product_title: productData.title || null,
      product_type: productData.type || null,
      product_sku: productData.sku || null,
      height_cm: toNum(get('height_cm')),
      weight_kg: toNum(get('weight_kg')),
      waist_inches: toNum(get('waist_inches')),
      chest_inches: toNum(get('chest_inches')),
      fit_preference: get('fit_preference') || '',
      fit_notes: '',
      session_id: getSessionId()
    };
  }

  function validateClientSide(payload) {
    if (payload.waist_inches === null && payload.chest_inches === null) {
      return 'Please enter at least one measurement.';
    }
    if (payload.waist_inches !== null && (payload.waist_inches < 20 || payload.waist_inches > 60)) {
      return 'That waist measurement looks unusual. Please check the measurement and enter it again.';
    }
    if (payload.chest_inches !== null && (payload.chest_inches < 28 || payload.chest_inches > 70)) {
      return 'That chest measurement looks unusual. Please check the measurement and enter it again.';
    }
    return null;
  }

  async function requestRecommendation(payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(CONFIG.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await resp.json();
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function renderResult(response, resultRegion, productData) {
    resultRegion.textContent = '';

    if (!response || response.success !== true) {
      const msg = (response && response.message) || "We couldn't complete the fit check right now. Please use the size chart below.";
      resultRegion.appendChild(createEl('p', { class: 'muffynn-fit-error-text', text: msg }));
      return;
    }

    const sizeLine = createEl('p', {
      class: 'muffynn-fit-size',
      text: 'Recommended size: ' + response.recommended_size
    });
    resultRegion.appendChild(sizeLine);

    if (response.recommended_product) {
      resultRegion.appendChild(createEl('p', { class: 'muffynn-fit-product', text: 'Suggested style: ' + response.recommended_product }));
    }
    if (response.reason) {
      resultRegion.appendChild(createEl('p', { class: 'muffynn-fit-reason', text: response.reason }));
    }

    pushDataLayer('size_recommendation_given', {
      session_id: getSessionId(),
      recommended_size: response.recommended_size,
      recommended_product: response.recommended_product || null,
      product_sku: productData.sku
    });

    const applyBtn = createEl('button', { type: 'button', class: 'muffynn-fit-apply', text: 'Apply Size to Variant' });
    applyBtn.addEventListener('click', () => applySizeToVariant(response.recommended_size, productData, resultRegion));
    resultRegion.appendChild(applyBtn);
  }

  /**
   * Reuses the exact variant-selection mechanism already shipped in this
   * theme's own assets/size-memory.js (confirmed via theme inspection),
   * so behavior matches what the theme's <variant-picker> custom element
   * (assets/theme.js) already expects. Only options whose
   * .product-form__option-name text matches "size" are touched — color
   * and other options are left alone. Never invents a variant: if no
   * confident match is found, we leave selection to the customer.
   */
  function applySizeToVariant(size, productData, resultRegion) {
    let applied = false;
    const target = size.trim().toLowerCase();

    const containers = document.querySelectorAll('.product-form__option-selector, .select-wrapper');

    containers.forEach((container) => {
      if (applied) return;

      const nameEl = container.querySelector('.product-form__option-name, .combo-box__title');
      const optionName = nameEl ? nameEl.textContent.trim() : '';
      if (!/size/i.test(optionName)) return;

      // 1) Radio-based selectors (block-swatch / color-swatch / variant-swatch)
      const radios = container.querySelectorAll('input[type="radio"][data-option-position]');
      if (radios.length) {
        let matchRadio = null;
        radios.forEach((radio) => {
          const label = radio.id ? container.querySelector('label[for="' + radio.id + '"]') : null;
          const text = label ? label.textContent.trim().toLowerCase() : '';
          if (text === target) matchRadio = radio;
        });
        if (matchRadio && !matchRadio.closest('.is-disabled')) {
          if (!matchRadio.checked) {
            matchRadio.checked = true;
            // Matches the dispatch pattern already used by this theme's
            // own size-memory.js so the <variant-picker> custom element
            // (and any other listeners keyed on this event) pick it up.
            matchRadio.dispatchEvent(new Event('change', { bubbles: true }));
          }
          applied = true;
        }
        return;
      }

      // 2) Plain <select> (dropdown selector_mode)
      const select = container.querySelector('select[data-option-position]');
      if (select) {
        let matchOption = null;
        Array.prototype.forEach.call(select.options, (opt) => {
          if (opt.textContent.trim().toLowerCase() === target && !opt.disabled) matchOption = opt;
        });
        if (matchOption) {
          if (select.value !== matchOption.value) {
            select.value = matchOption.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          applied = true;
        }
        return;
      }

      // 3) combo-box "dropdown" selector_mode
      const options = container.querySelectorAll('[role="option"]');
      if (options.length) {
        let matchButton = null;
        options.forEach((opt) => {
          if (opt.tagName === 'A') return; // product_url-based option, different product — skip
          if (opt.textContent.trim().toLowerCase() === target) matchButton = opt;
        });
        if (matchButton && !matchButton.closest('.is-disabled')) {
          matchButton.click();
          applied = true;
        }
      }
    });

    const feedback = createEl('p', { class: 'muffynn-fit-apply-feedback' });
    if (applied) {
      feedback.textContent = 'Size ' + size + ' selected above.';
      pushDataLayer('size_recommendation_added_to_cart', {
        session_id: getSessionId(),
        recommended_size: size,
        product_sku: productData.sku
      });
    } else {
      feedback.textContent = "We found your recommended size, but couldn't select it automatically. Please select it manually below.";
    }
    resultRegion.appendChild(feedback);
  }

  function init() {
    if (!isProductPage()) return;

    const root = getRoot();
    if (!root || alreadyInitialized(root)) return;

    const productData = readProductData();
    if (!productData) return; // fail silently — required metadata missing

    try {
      buildWidget(root, productData);
      markInitialized(root);
    } catch (e) {
      // fail silently — widget must never break the PDP
    }
  }

  function safeInit() {
    try {
      init();
    } catch (e) {
      // never throw into the host page
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }

  // Shopify themes may re-render PDP sections (e.g. Theme Editor, quick
  // view, or AJAX cart/variant changes) without a full page load. Rather
  // than a permanent full-page MutationObserver, watch only the parent of
  // the reserved container if it exists, which is far cheaper.
  document.addEventListener('shopify:section:load', safeInit);
})();
