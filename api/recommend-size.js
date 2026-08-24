/**
 * FILE: /api/recommend-size.js
 * PURPOSE: Vercel Node.js Serverless Function.
 *
 * Order of operations:
 *   CORS -> method handling -> validation -> deterministic engine
 *   -> optional LLM (<=1400ms, never overrides size) -> JSON response
 *
 * No database. No Google Sheets. No background analytics dependency.
 */

'use strict';

const { validatePayloadSize, validateRecommendRequest } = require('../lib/validation');
const { getRecommendation } = require('../lib/sizing-engine');

const ALLOWED_ORIGINS = ['https://muffynn.com', 'https://www.muffynn.com'];
const LLM_TIMEOUT_MS = 1400;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Reads and parses the raw request body defensively. Vercel's Node runtime
 * gives you a parsed `req.body` in many configurations, but we handle the
 * raw-stream case too so payload-size validation runs on the real bytes.
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && typeof req.body !== 'undefined' && req.readableEnded !== false) {
      // Some Vercel configs pre-parse the body. Fall back to it directly.
      if (typeof req.body === 'string') return resolve(req.body);
      if (typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    }
    let data = '';
    let tooLarge = false;
    const MAX_BYTES = 10 * 1024;
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('PAYLOAD_TOO_LARGE'));
      resolve(data);
    });
    req.on('error', reject);
  });
}

/**
 * Optional LLM interpretation layer. Never throws — always resolves to
 * either an interpretation object or null. Caller treats null as
 * "deterministic result only."
 *
 * REQUIRES CONFIGURATION: set LLM_PROVIDER + the matching API key in
 * Vercel environment variables to enable. Defaults to disabled.
 */
async function getOptionalLlmInterpretation(input, deterministicResult) {
  const provider = (process.env.LLM_PROVIDER || 'none').toLowerCase();
  if (provider === 'none') return null;
  if (provider !== 'openai' && provider !== 'anthropic') return null;

  const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  // Keep the prompt tight and never pass arbitrary unbounded user text —
  // fit_preference/fit_notes are already length-limited by validation.js.
  const promptContext = {
    fit_preference: input.fit_preference,
    fit_notes: input.fit_notes,
    deterministic_size: deterministicResult.recommended_size,
    deterministic_product: deterministicResult.recommended_product
  };

  const systemInstruction =
    'You interpret a customer\'s natural-language fit preference for an ' +
    'e-commerce sizing widget. You NEVER change the given deterministic ' +
    'size. You may only suggest which product line best matches their ' +
    'stated preference and phrase a short (<40 word) customer-facing reason. ' +
    'Respond ONLY with JSON: {"recommended_product": string|null, "reason": string}. ' +
    'No other text, no markdown fences.';

  try {
    let responseText = null;

    if (provider === 'openai') {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: JSON.stringify(promptContext) }
          ],
          max_tokens: 200,
          temperature: 0.3
        }),
        signal: controller.signal
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      responseText = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    } else {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: systemInstruction,
          messages: [{ role: 'user', content: JSON.stringify(promptContext) }]
        }),
        signal: controller.signal
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      responseText = data && data.content && data.content[0] && data.content[0].text;
    }

    if (!responseText) return null;

    let parsed;
    try {
      parsed = JSON.parse(responseText.trim());
    } catch (e) {
      return null; // malformed LLM output -> deterministic result stands
    }

    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.reason !== 'string' || parsed.reason.length === 0 || parsed.reason.length > 400) return null;

    return {
      recommended_product:
        typeof parsed.recommended_product === 'string' ? parsed.recommended_product.slice(0, 120) : deterministicResult.recommended_product,
      reason: parsed.reason
    };
  } catch (err) {
    return null; // timeout, network error, abort -> deterministic result stands
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error_code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.' });
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    sendJson(res, 415, { success: false, error_code: 'INVALID_CONTENT_TYPE', message: 'Content-Type must be application/json.' });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { success: false, error_code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
      return;
    }
    sendJson(res, 400, { success: false, error_code: 'READ_ERROR', message: 'Could not read request body.' });
    return;
  }

  const sizeCheck = validatePayloadSize(rawBody);
  if (!sizeCheck.valid) {
    sendJson(res, 413, { success: false, error_code: sizeCheck.error_code, message: sizeCheck.message });
    return;
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (err) {
    sendJson(res, 400, { success: false, error_code: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
    return;
  }

  const validation = validateRecommendRequest(parsedBody);
  if (!validation.valid) {
    sendJson(res, 400, { success: false, error_code: validation.error_code, message: validation.message });
    return;
  }

  const input = validation.data;

  // Never send obviously invalid measurements to an LLM — validation has
  // already rejected out-of-range values above, so anything reaching this
  // point is within configured bounds.
  let result;
  try {
    result = getRecommendation(input);
  } catch (err) {
    // Never expose stack traces or internals.
    sendJson(res, 500, { success: false, error_code: 'INTERNAL_ERROR', message: 'Something went wrong while calculating your size.' });
    return;
  }

  if (!result.success) {
    sendJson(res, 200, result);
    return;
  }

  const llmInterpretation = await getOptionalLlmInterpretation(input, result);

  if (llmInterpretation) {
    sendJson(res, 200, {
      success: true,
      recommended_size: result.recommended_size, // deterministic engine remains source of truth
      recommended_product: llmInterpretation.recommended_product || result.recommended_product,
      reason: llmInterpretation.reason,
      source: 'deterministic+llm'
    });
    return;
  }

  sendJson(res, 200, {
    success: true,
    recommended_size: result.recommended_size,
    recommended_product: result.recommended_product,
    reason: result.reason,
    source: 'deterministic'
  });
};
