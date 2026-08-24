/**
 * FILE: /lib/sizing-engine.js
 * PURPOSE: Authoritative deterministic sizing engine.
 *
 * Responsibilities:
 *  - category detection
 *  - chart lookup
 *  - measurement comparison
 *  - product-line recommendation
 *  - fallback reason
 *
 * No LLM calls. No network calls. No Shopify calls.
 *
 * ============================================================
 * REQUIRES CONFIGURATION
 * ============================================================
 * The numeric size-chart values below are PLACEHOLDERS ONLY.
 * They are structured to show the expected shape (size -> waist/chest
 * range in inches) but do NOT reflect Muffynn's actual measurements.
 * Replace every chart with the real Muffynn size-chart data before
 * this goes anywhere near production. Do not ship placeholder numbers.
 *
 * Note from theme inspection: the theme's own variant_picker block
 * settings reference `product.metafields.custom.size_chart.value` — a
 * link to a Shopify page per product line. That page holds the real
 * numbers (it's admin content, not theme code, so it wasn't in the
 * theme export). Pull the actual waist/chest ranges from there.
 * ============================================================
 */

'use strict';

const SIZE_CHARTS = {
  // REQUIRES CONFIGURATION — placeholder shape only
  truefit: {
    measurement: 'waist_inches',
    ranges: [
      { size: 'S', min: 28, max: 30 },
      { size: 'M', min: 31, max: 33 },
      { size: 'L', min: 34, max: 36 },
      { size: 'XL', min: 37, max: 40 }
    ]
  },

  flexiwaist: {
    // REQUIRES CONFIGURATION — placeholder shape only
    measurement: 'waist_inches',
    ranges: [
      { size: 'S', min: 28, max: 30 },
      { size: 'M', min: 31, max: 33 },
      { size: 'L', min: 34, max: 36 },
      { size: 'XL', min: 37, max: 40 }
    ]
  },

  trueall_day: {
    // REQUIRES CONFIGURATION — placeholder shape only
    measurement: 'waist_inches',
    ranges: [
      { size: 'S', min: 28, max: 30 },
      { size: 'M', min: 31, max: 33 },
      { size: 'L', min: 34, max: 36 },
      { size: 'XL', min: 37, max: 40 }
    ]
  },

  flexiplus_straight: {
    // REQUIRES CONFIGURATION — placeholder shape only
    measurement: 'waist_inches',
    ranges: [
      { size: 'S', min: 28, max: 30 },
      { size: 'M', min: 31, max: 33 },
      { size: 'L', min: 34, max: 36 },
      { size: 'XL', min: 37, max: 40 }
    ]
  },

  tshirt: {
    // REQUIRES CONFIGURATION — placeholder shape only
    measurement: 'chest_inches',
    ranges: [
      { size: 'S', min: 34, max: 36 },
      { size: 'M', min: 37, max: 39 },
      { size: 'L', min: 40, max: 42 },
      { size: 'XL', min: 43, max: 46 }
    ]
  },

  oversized_tshirt: {
    // REQUIRES CONFIGURATION — oversized products MUST use their own chart,
    // never the standard tshirt chart. Placeholder shape only.
    measurement: 'chest_inches',
    ranges: [
      { size: 'S', min: 36, max: 39 },
      { size: 'M', min: 40, max: 43 },
      { size: 'L', min: 44, max: 47 },
      { size: 'XL', min: 48, max: 51 }
    ]
  },

  shirt: {
    // REQUIRES CONFIGURATION — placeholder shape only
    measurement: 'chest_inches',
    ranges: [
      { size: 'S', min: 34, max: 36 },
      { size: 'M', min: 37, max: 39 },
      { size: 'L', min: 40, max: 42 },
      { size: 'XL', min: 43, max: 46 }
    ]
  },

  hoodie: {
    // REQUIRES CONFIGURATION — placeholder shape only
    measurement: 'chest_inches',
    ranges: [
      { size: 'S', min: 36, max: 39 },
      { size: 'M', min: 40, max: 43 },
      { size: 'L', min: 44, max: 47 },
      { size: 'XL', min: 48, max: 51 }
    ]
  }
};

// Keyword-based category detection from product_type / product_title.
// REQUIRES CONFIGURATION: tune these keyword lists against Muffynn's actual
// product taxonomy once the theme/catalog has been inspected.
const CATEGORY_KEYWORDS = [
  { chart_key: 'oversized_tshirt', keywords: ['oversized t-shirt', 'oversized tee', 'oversized tshirt'] },
  { chart_key: 'hoodie', keywords: ['hoodie', 'sweatshirt'] },
  { chart_key: 'shirt', keywords: ['shirt', 'formal shirt', 'casual shirt'] },
  { chart_key: 'tshirt', keywords: ['t-shirt', 'tee', 'tshirt'] },
  { chart_key: 'trouser', keywords: ['trouser', 'pant', 'chino'] }
];

const FIT_KEYWORDS = {
  relaxed: ['comfortable', 'roomier', 'relaxed', 'not body-hugging', 'more room', 'loose'],
  all_day_stretch: ['full waist flexibility', 'maximum stretch', 'maximum waistband comfort', 'fully elastic', 'drawstring'],
  formal: ['formal', 'office wear', 'office', 'dressier', 'clean formal', 'formal trousers'],
  long_fit: ['longer trousers', 'extra length', 'long fit', 'long trousers']
};

function textIncludesAny(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

/**
 * Detects a base garment family (trouser/tshirt/shirt/hoodie/unknown)
 * from product_type and product_title.
 */
function detectCategory(productType, productTitle) {
  const haystack = `${productType || ''} ${productTitle || ''}`.toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (textIncludesAny(haystack, entry.keywords)) {
      return entry.chart_key === 'trouser' ? 'trouser' : entry.chart_key;
    }
  }
  return 'unknown';
}

/**
 * Applies the Muffynn product-line rule engine for trousers.
 * Returns a chart_key and a human-readable product line name, or null
 * if no explicit preference keywords matched (caller falls back to a
 * neutral trouser chart / default line).
 */
function detectTrouserProductLine(fitPreference, fitNotes, heightCm) {
  const text = `${fitPreference || ''} ${fitNotes || ''}`;

  // RULE 4 checked first since it is height-gated and most specific.
  if (heightCm && heightCm > 178 && textIncludesAny(text, FIT_KEYWORDS.long_fit)) {
    return { chart_key: 'flexiplus_straight', product_line: 'Flexiplus Straight Fit' };
  }

  if (textIncludesAny(text, FIT_KEYWORDS.all_day_stretch)) {
    return {
      chart_key: 'trueall_day',
      product_line: 'TrueFit All Day Pants',
      highlight: 'Full elastic waistband + drawstring comfort.'
    };
  }

  if (textIncludesAny(text, FIT_KEYWORDS.formal)) {
    return {
      chart_key: 'flexiwaist',
      product_line: 'Flexiwaist Formal Pants',
      highlight: 'Formal appearance with controlled waistband stretch.'
    };
  }

  if (textIncludesAny(text, FIT_KEYWORDS.relaxed)) {
    return { chart_key: 'truefit', product_line: 'Straight Fit / TrueFit' };
  }

  return null;
}

/**
 * Looks up a size from a chart given a measurement value.
 * Returns { size, chart_key } or null if out of range on both ends
 * (caller decides how to phrase the "insufficient data" response).
 */
function lookupSizeFromChart(chartKey, measurementValue) {
  const chart = SIZE_CHARTS[chartKey];
  if (!chart || measurementValue === null || measurementValue === undefined) return null;

  for (const range of chart.ranges) {
    if (measurementValue >= range.min && measurementValue <= range.max) {
      return { size: range.size, chart_key: chartKey };
    }
  }

  // Below smallest / above largest: clamp to nearest boundary rather than
  // inventing a size, and flag it so the reason text can be honest about it.
  const sorted = chart.ranges;
  if (measurementValue < sorted[0].min) {
    return { size: sorted[0].size, chart_key: chartKey, clamped: 'below_range' };
  }
  const last = sorted[sorted.length - 1];
  if (measurementValue > last.max) {
    return { size: last.size, chart_key: chartKey, clamped: 'above_range' };
  }
  return null;
}

/**
 * Main entry point. Given normalized request data, returns:
 * {
 *   success: true,
 *   recommended_size,
 *   recommended_product,
 *   reason,
 *   source: 'deterministic'
 * }
 * or
 * {
 *   success: false,
 *   error_code,
 *   message
 * }
 */
function getRecommendation(input) {
  const {
    product_type,
    product_title,
    fit_preference,
    fit_notes,
    height_cm,
    waist_inches,
    chest_inches
  } = input;

  const category = detectCategory(product_type, product_title);

  if (category === 'trouser') {
    if (waist_inches === null) {
      return {
        success: false,
        error_code: 'INSUFFICIENT_DATA',
        message: 'We need your waist measurement to recommend a trouser size.'
      };
    }

    const productLine = detectTrouserProductLine(fit_preference, fit_notes, height_cm);
    const chartKey = productLine ? productLine.chart_key : 'truefit';
    const sizeResult = lookupSizeFromChart(chartKey, waist_inches);

    if (!sizeResult) {
      return {
        success: false,
        error_code: 'NO_SIZE_MATCH',
        message: 'We could not find a confident size match. Please check the size chart below.'
      };
    }

    // Do NOT size down because the garment stretches — actual body waist
    // measurement maps directly onto the configured chart.
    let reason = `Your ${waist_inches}-inch waist maps to ${sizeResult.size} on this product's configured size chart.`;
    if (sizeResult.clamped === 'below_range') {
      reason = `Your ${waist_inches}-inch waist is below this chart's smallest listed size; ${sizeResult.size} is the closest available match.`;
    } else if (sizeResult.clamped === 'above_range') {
      reason = `Your ${waist_inches}-inch waist is above this chart's largest listed size; ${sizeResult.size} is the closest available match.`;
    }

    const recommendedProduct = productLine ? productLine.product_line : null;
    if (productLine && productLine.highlight) {
      reason += ` ${productLine.highlight}`;
    }

    return {
      success: true,
      recommended_size: sizeResult.size,
      recommended_product: recommendedProduct,
      reason,
      source: 'deterministic'
    };
  }

  if (['tshirt', 'oversized_tshirt', 'shirt', 'hoodie'].includes(category)) {
    if (chest_inches === null) {
      return {
        success: false,
        error_code: 'INSUFFICIENT_DATA',
        message: 'We need your chest measurement to recommend a size for this product.'
      };
    }

    const sizeResult = lookupSizeFromChart(category, chest_inches);
    if (!sizeResult) {
      return {
        success: false,
        error_code: 'NO_SIZE_MATCH',
        message: 'We could not find a confident size match. Please check the size chart below.'
      };
    }

    let reason = `Your ${chest_inches}-inch chest maps to ${sizeResult.size} on this product's configured size chart.`;
    if (sizeResult.clamped === 'below_range') {
      reason = `Your ${chest_inches}-inch chest is below this chart's smallest listed size; ${sizeResult.size} is the closest available match.`;
    } else if (sizeResult.clamped === 'above_range') {
      reason = `Your ${chest_inches}-inch chest is above this chart's largest listed size; ${sizeResult.size} is the closest available match.`;
    }

    return {
      success: true,
      recommended_size: sizeResult.size,
      recommended_product: null,
      reason,
      source: 'deterministic'
    };
  }

  // Unknown category: safe generic fallback. We do not invent a chart.
  return {
    success: false,
    error_code: 'UNKNOWN_CATEGORY',
    message: 'We could not automatically determine the right chart for this product. Please use the size chart below.'
  };
}

module.exports = {
  SIZE_CHARTS,
  detectCategory,
  detectTrouserProductLine,
  lookupSizeFromChart,
  getRecommendation
};
