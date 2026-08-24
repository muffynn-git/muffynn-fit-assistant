/**
 * FILE: /lib/validation.js
 * PURPOSE: Centralized API request validation for the recommend-size endpoint.
 * No network calls. No Shopify calls. Pure functions only.
 */

'use strict';

// Centralized numeric/string limits. Do not scatter these elsewhere.
const INPUT_LIMITS = {
  waist_inches: { min: 20, max: 60 },
  chest_inches: { min: 28, max: 70 },
  height_cm: { min: 120, max: 230 },
  weight_kg: { min: 30, max: 250 }
};

const STRING_LIMITS = {
  product_id: 128,
  variant_id: 128,
  product_title: 256,
  product_type: 128,
  product_sku: 128,
  fit_preference: 300,
  fit_notes: 500,
  session_id: 64
};

// Hard cap on total JSON payload size (bytes) before we even attempt to parse.
const MAX_PAYLOAD_BYTES = 10 * 1024; // 10 KB is generous for this payload shape

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates raw request body size (as a string/Buffer length) before parsing.
 */
function validatePayloadSize(rawBody) {
  const byteLength = Buffer.byteLength(rawBody || '', 'utf8');
  if (byteLength > MAX_PAYLOAD_BYTES) {
    return { valid: false, error_code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  }
  return { valid: true };
}

/**
 * Validates that a string field is within its configured length limit.
 * Returns null if valid, or an error object if invalid.
 */
function validateStringField(fieldName, value, required) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      return { error_code: 'MISSING_FIELD', message: `Missing required field: ${fieldName}.` };
    }
    return null;
  }
  if (typeof value !== 'string') {
    return { error_code: 'INVALID_FIELD_TYPE', message: `Field ${fieldName} must be a string.` };
  }
  const limit = STRING_LIMITS[fieldName];
  if (limit && value.length > limit) {
    return { error_code: 'FIELD_TOO_LONG', message: `Field ${fieldName} exceeds the maximum allowed length.` };
  }
  return null;
}

/**
 * Validates a numeric measurement field against INPUT_LIMITS.
 * Returns null if valid/absent-and-optional, or an error object if invalid.
 */
function validateMeasurement(fieldName, value, required) {
  if (value === undefined || value === null) {
    if (required) {
      return { error_code: 'MISSING_FIELD', message: `Missing required measurement: ${fieldName}.` };
    }
    return null;
  }
  if (!isFiniteNumber(value)) {
    return { error_code: 'INVALID_MEASUREMENT', message: `${fieldName} must be a valid number.` };
  }
  const limits = INPUT_LIMITS[fieldName];
  if (!limits) return null;
  if (value < limits.min || value > limits.max) {
    return {
      error_code: 'INVALID_MEASUREMENT',
      message: `That ${fieldName.replace('_', ' ')} looks unusual. Please check the measurement and enter it again.`
    };
  }
  return null;
}

/**
 * Top-level validator for the /api/recommend-size request body.
 * Returns { valid: true, data: <normalized payload> }
 * or { valid: false, error_code, message }.
 */
function validateRecommendRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error_code: 'INVALID_JSON', message: 'Request body must be a JSON object.' };
  }

  // Required identifying fields
  const requiredStrings = ['product_id', 'session_id'];
  for (const field of requiredStrings) {
    const err = validateStringField(field, body[field], true);
    if (err) return { valid: false, ...err };
  }

  // Optional identifying/context strings
  const optionalStrings = [
    'variant_id',
    'product_title',
    'product_type',
    'product_sku',
    'fit_preference',
    'fit_notes'
  ];
  for (const field of optionalStrings) {
    const err = validateStringField(field, body[field], false);
    if (err) return { valid: false, ...err };
  }

  // session_id shape check (defense in depth beyond length)
  if (!/^mf_[a-zA-Z0-9_-]{4,60}$/.test(body.session_id)) {
    return { valid: false, error_code: 'INVALID_SESSION', message: 'Invalid session identifier.' };
  }

  // Measurements: none are strictly required at the validation layer because
  // trousers need waist, tops need chest, and the caller may not have both.
  // The sizing engine decides whether it has enough data to recommend.
  const measurementErrs = [
    validateMeasurement('height_cm', body.height_cm, false),
    validateMeasurement('weight_kg', body.weight_kg, false),
    validateMeasurement('waist_inches', body.waist_inches, false),
    validateMeasurement('chest_inches', body.chest_inches, false)
  ].filter(Boolean);

  if (measurementErrs.length > 0) {
    return { valid: false, ...measurementErrs[0] };
  }

  const normalized = {
    product_id: String(body.product_id).trim(),
    variant_id: isNonEmptyString(body.variant_id) ? body.variant_id.trim() : null,
    product_title: isNonEmptyString(body.product_title) ? body.product_title.trim() : null,
    product_type: isNonEmptyString(body.product_type) ? body.product_type.trim() : null,
    product_sku: isNonEmptyString(body.product_sku) ? body.product_sku.trim() : null,
    height_cm: isFiniteNumber(body.height_cm) ? body.height_cm : null,
    weight_kg: isFiniteNumber(body.weight_kg) ? body.weight_kg : null,
    waist_inches: isFiniteNumber(body.waist_inches) ? body.waist_inches : null,
    chest_inches: isFiniteNumber(body.chest_inches) ? body.chest_inches : null,
    fit_preference: isNonEmptyString(body.fit_preference) ? body.fit_preference.trim() : '',
    fit_notes: isNonEmptyString(body.fit_notes) ? body.fit_notes.trim() : '',
    session_id: body.session_id.trim()
  };

  return { valid: true, data: normalized };
}

module.exports = {
  INPUT_LIMITS,
  STRING_LIMITS,
  MAX_PAYLOAD_BYTES,
  validatePayloadSize,
  validateRecommendRequest
};
