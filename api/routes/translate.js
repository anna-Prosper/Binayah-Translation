'use strict';
const axios = require('axios');
const { WP, HEADERS } = require('../lib/wp-env');
const cache  = require('../lib/translation-cache');
const freq   = require('../lib/string-frequency');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

function md5(text) { return crypto.createHash('md5').update(String(text)).digest('hex'); }

// Languages with rich morphology (grammatical cases) where cross-page text reuse breaks
// grammatical agreement. For these, only reuse a translation if it has been seen on
// GLOBAL_THRESHOLD or more distinct pages — meaning it's a repeated global string
// (header, footer, nav) rather than page-specific body content.
const MORPHOLOGICALLY_COMPLEX = new Set(['ru', 'de']);
const GLOBAL_THRESHOLD = 3;
const fs      = require('fs');
const dataDir = require('../lib/data-dir');

const CFG        = dataDir('language-config.json');
const USAGE      = dataDir('usage-stats.json');
const GLOBAL_CFG = dataDir('global-config.json');
const PAGE_CFG   = dataDir('page-config.json');
const TRANS_LOG  = dataDir('translation-log.json');
const HASH_STORE = dataDir('field-hashes.json');

// Node-side hash store: { "{post_id}:{lang}:{field_key}": "md5hex" }
// Used to detect stale translations without requiring WP plugin changes.
function readHashes() { try { return JSON.parse(fs.readFileSync(HASH_STORE,'utf8')); } catch { return {}; } }
function saveHashes(h) { fs.writeFileSync(HASH_STORE, JSON.stringify(h)); }
function getFieldHash(post_id, lang, key) { return readHashes()[`${post_id}:${lang}:${key}`] || null; }
function setFieldHashes(post_id, lang, fieldMap) {
  const h = readHashes();
  for (const [key, text] of Object.entries(fieldMap)) h[`${post_id}:${lang}:${key}`] = md5(String(text));
  saveHashes(h);
}

const readCfg     = () => { try { return JSON.parse(fs.readFileSync(CFG,'utf8')); } catch { return []; } };
const readGlobal  = () => { try { return JSON.parse(fs.readFileSync(GLOBAL_CFG,'utf8')); } catch { return {api:'deepseek',model:'deepseek-chat'}; } };
const readPageCfg = () => { try { return JSON.parse(fs.readFileSync(PAGE_CFG,'utf8')); } catch { return {}; } };
const savePageCfg = (d) => fs.writeFileSync(PAGE_CFG, JSON.stringify(d,null,2));

function resolveApiModel(page_id, lang) {
  const g    = readGlobal();
  const lCfg = readCfg().find(l => l.code===lang) || {};
  const pCfg = readPageCfg()[page_id] || {};
  const pLang = (pCfg.langModels || {})[lang] || {};
  const api    = pLang.api  || pCfg.api   || lCfg.api   || g.api   || 'deepseek';
  const defMdl = api==='openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
  const model  = pLang.model || pCfg.model || lCfg.model || g.model || defMdl;
  return { api, model };
}

function appendLog(entry) {
  try {
    const logs = fs.existsSync(TRANS_LOG) ? JSON.parse(fs.readFileSync(TRANS_LOG,'utf8')) : [];
    logs.unshift(entry);
    if (logs.length > 5000) logs.splice(5000);
    fs.writeFileSync(TRANS_LOG, JSON.stringify(logs));
  } catch(e) {}
}

const jobs = new Map();

// Cross-page translation memory — same text + lang = reuse across all pages within this server session
const _xMem = new Map();
function xmGet(text, lang) { return _xMem.has(text + '|' + lang) ? _xMem.get(text + '|' + lang) : null; }
function xmSet(text, lang, tr) { if (tr && tr !== text) _xMem.set(text + '|' + lang, tr); }

async function waitIfPaused(job) {
  while (job.paused && !job.stopped) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

function isAIMetaResponse(text) {
  if (!text || text.length < 10) return false;
  const lower = text.toLowerCase();
  const bad = [
    'i\'d be happy to help','i\'m happy to help','i cannot translate','i\'m unable to',
    'haven\'t provided','please provide the','could you please share',
    'no content to translate','as an ai','i\'m an ai',
    'what would you like me to translate','you haven\'t provided','provide the content you',
  ];
  return bad.some(p => lower.includes(p));
}

function shouldTranslate(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 2) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^\d+(\.\d+)?$/.test(t)) return false;
  if (/^[\d\s,.\-+()%\/]+$/.test(t)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|mp4|mp3|ico|woff2?)(\?.*)?$/i.test(t)) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return false;
  if (/^[0-9a-f]{32,}$/i.test(t)) return false;
  const stripped = t.replace(/<[^>]+>/g,'').trim();
  if (t !== stripped && stripped.length < 2) return false;
  if (/^[a-zA-Z0-9]{1,2}$/.test(t)) return false;
  return true;
}

function trackUsage(lang, api, fields) {
  try {
    let s; try { s = JSON.parse(fs.readFileSync(USAGE,'utf8')); } catch { s={total:{calls:0,fields:0},by_api:{},by_language:{},recent:[]}; }
    s.total.calls=(s.total.calls||0)+1; s.total.fields=(s.total.fields||0)+fields;
    if (!s.by_api[api]) s.by_api[api]={calls:0,fields:0};
    if (!s.by_language[lang]) s.by_language[lang]={calls:0,fields:0};
    s.by_api[api].calls++; s.by_api[api].fields+=fields;
    s.by_language[lang].calls++; s.by_language[lang].fields+=fields;
    s.recent=[{date:new Date().toISOString().slice(0,10),lang,api,fields},...(s.recent||[])].slice(0,50);
    fs.writeFileSync(USAGE,JSON.stringify(s,null,2));
  } catch {}
}

const DEFAULT_PROMPT_TEMPLATE =
  'You are a professional translator. Translate the following text to {language}.\n' +
  'RULES:\n' +
  '- Return ONLY the translated text, nothing else.\n' +
  '- Preserve ALL HTML tags exactly as written.\n' +
  '- Do NOT translate: URLs, email addresses, or file/image paths.\n' +
  '- For right-to-left languages (Arabic, Persian, Hebrew): write naturally right-to-left.';

const LANG_NAMES_FULL = {ar:'Arabic',he:'Hebrew',fa:'Persian',fr:'French',es:'Spanish',de:'German',ru:'Russian',zh:'Chinese (Simplified)',hi:'Hindi',it:'Italian',pt:'Portuguese',tr:'Turkish',ja:'Japanese',ko:'Korean',nl:'Dutch',sv:'Swedish',pl:'Polish',uk:'Ukrainian',da:'Danish',fi:'Finnish',nb:'Norwegian',cs:'Czech',hu:'Hungarian',ro:'Romanian',bg:'Bulgarian',hr:'Croatian',sk:'Slovak',sl:'Slovenian',et:'Estonian',lv:'Latvian',lt:'Lithuanian',el:'Greek',vi:'Vietnamese',th:'Thai',id:'Indonesian',ms:'Malay'};

function buildSystemPrompt(lang, template) {
  const langName = LANG_NAMES_FULL[lang] || lang;
  const tpl = (template && template.trim()) ? template.trim() : DEFAULT_PROMPT_TEMPLATE;
  return tpl.replace(/\{language\}/gi, langName);
}

function resolvePrompt(page_id, lang, overridePrompt) {
  if (overridePrompt && overridePrompt.trim()) return buildSystemPrompt(lang, overridePrompt);
  const pageCfg = readPageCfg()[page_id] || {};
  const pagePrompt = ((pageCfg.prompts || {})[lang]) || pageCfg.prompt || '';
  if (pagePrompt.trim()) return buildSystemPrompt(lang, pagePrompt);
  const langEntry = readCfg().find(l => l.code === lang) || {};
  if (langEntry.prompt && langEntry.prompt.trim()) return buildSystemPrompt(lang, langEntry.prompt);
  const globalCfg = readGlobal();
  if (globalCfg.prompt && globalCfg.prompt.trim()) return buildSystemPrompt(lang, globalCfg.prompt);
  return buildSystemPrompt(lang, DEFAULT_PROMPT_TEMPLATE);
}

function classifyApiError(err, api) {
  const status  = err.response && err.response.status;
  const data    = (err.response && err.response.data) || {};
  const msg     = (data.error && (data.error.message || data.error.code || JSON.stringify(data.error))) || data.message || err.message || '';
  const msgL    = msg.toLowerCase();
  if (status === 402 || msgL.includes('credit') || msgL.includes('insufficient') || msgL.includes('balance') || msgL.includes('quota exceeded')) {
    return new Error('NO_CREDITS: No credits in ' + (api==='openrouter'?'OpenRouter':'DeepSeek') + '. Please top up your account and try again.');
  }
  if (status === 401 || msgL.includes('invalid api key') || msgL.includes('unauthorized') || msgL.includes('authentication')) {
    return new Error('INVALID_KEY: Invalid API key for ' + (api==='openrouter'?'OpenRouter':'DeepSeek') + '. Please check your key in Settings.');
  }
  if (status === 429 || msgL.includes('rate limit') || msgL.includes('too many requests') || msgL.includes('ratelimit')) {
    return new Error('RATE_LIMIT: Rate limit reached. Please wait a moment and try again.');
  }
  if (status === 503 || msgL.includes('overload') || msgL.includes('capacity') || msgL.includes('unavailable')) {
    return new Error('MODEL_BUSY: The AI model is currently overloaded. Please try again in a few minutes.');
  }
  if (status === 400 && (msgL.includes('token') || msgL.includes('context length') || msgL.includes('max_tokens'))) {
    return new Error('TOKEN_LIMIT: Token limit exceeded for this request. Try translating a shorter page.');
  }
  // Invalid / unknown model ID — must be fatal, otherwise the batch falls back to
  // echoing the original English text and silently "succeeds" with 0 tokens.
  if (status === 404 || msgL.includes('not a valid model') || msgL.includes('is not a valid') ||
      msgL.includes('no endpoints found') || msgL.includes('model not found') ||
      msgL.includes('no allowed providers') || msgL.includes('unknown model')) {
    return new Error('INVALID_MODEL: The selected AI model is invalid or unavailable. Please pick a valid model in Settings.');
  }
  return null;
}

// Single-text translation (fallback only)
async function translateText(text, lang, api, model, systemPrompt) {
  if (!shouldTranslate(text)) return { text, tokens: 0 };
  if (api==='openrouter') {
    const modelId = model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    try {
      const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
        {model:modelId,messages:[{role:'system',content:systemPrompt},{role:'user',content:text}],temperature:0.3,max_tokens:4000},
        {headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY,'HTTP-Referer':'https://binayah.com','X-Title':'Binayah Translate'},timeout:60000});
      const res = r.data.choices[0].message.content.trim();
      const inp = (r.data.usage && r.data.usage.prompt_tokens) || 0;
      const out = (r.data.usage && r.data.usage.completion_tokens) || 0;
      if (isAIMetaResponse(res)) return { text, tokens: 0, input_tokens: 0, output_tokens: 0 };
      return { text: res, tokens: inp+out, input_tokens: inp, output_tokens: out };
    } catch(err) { const fatal = classifyApiError(err,'openrouter'); if (fatal) throw fatal; throw err; }
  }
  const modelId = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  try {
    const r = await axios.post((process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com/v1')+'/chat/completions',
      {model:modelId,messages:[{role:'system',content:systemPrompt},{role:'user',content:text}],temperature:0.3,max_tokens:4000},
      {headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},timeout:60000});
    const res = r.data.choices[0].message.content.trim();
    const inp = (r.data.usage && r.data.usage.prompt_tokens) || 0;
    const out = (r.data.usage && r.data.usage.completion_tokens) || 0;
    if (isAIMetaResponse(res)) return { text, tokens: 0, input_tokens: 0, output_tokens: 0 };
    return { text: res, tokens: inp+out, input_tokens: inp, output_tokens: out };
  } catch(err) { const fatal = classifyApiError(err,'deepseek'); if (fatal) throw fatal; throw err; }
}

// Batch translate multiple unique texts in one API call — massive speed + token savings
const BATCH_SIZE = 30;

async function translateBatch(texts, lang, api, model, systemPrompt) {
  if (!texts.length) return { map: {}, tokens: 0, input_tokens: 0, output_tokens: 0 };
  const map = {};
  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const batchMsg = 'Translate each text below. Return ONLY a valid JSON array with exactly ' + chunk.length + ' strings in the same order. No explanation, no markdown, just the JSON array.\n\n' + JSON.stringify(chunk);

    try {
      let raw = '';
      let tokens = 0;

      if (api === 'openrouter') {
        const modelId = model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
        const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
          {model:modelId,messages:[{role:'system',content:systemPrompt},{role:'user',content:batchMsg}],temperature:0.2,max_tokens:8000},
          {headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY,'HTTP-Referer':'https://binayah.com','X-Title':'Binayah Translate'},timeout:120000});
        raw = r.data.choices[0].message.content.trim();
        tokens = ((r.data.usage && r.data.usage.prompt_tokens) || 0) + ((r.data.usage && r.data.usage.completion_tokens) || 0);
        totalInputTokens  += (r.data.usage && r.data.usage.prompt_tokens)     || 0;
        totalOutputTokens += (r.data.usage && r.data.usage.completion_tokens) || 0;
      } else {
        const modelId = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        const r = await axios.post((process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com/v1')+'/chat/completions',
          {model:modelId,messages:[{role:'system',content:systemPrompt},{role:'user',content:batchMsg}],temperature:0.2,max_tokens:8000},
          {headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},timeout:120000});
        raw = r.data.choices[0].message.content.trim();
        tokens = ((r.data.usage && r.data.usage.prompt_tokens) || 0) + ((r.data.usage && r.data.usage.completion_tokens) || 0);
        totalInputTokens  += (r.data.usage && r.data.usage.prompt_tokens)     || 0;
        totalOutputTokens += (r.data.usage && r.data.usage.completion_tokens) || 0;
      }

      totalTokens += tokens;

      // Parse JSON response — try direct parse, then extract array
      let translated = null;
      try { translated = JSON.parse(raw); } catch {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) try { translated = JSON.parse(m[0]); } catch {}
      }

      if (Array.isArray(translated) && translated.length === chunk.length) {
        chunk.forEach((t, idx) => { map[t] = String(translated[idx] || t); });
      } else {
        // Fallback: translate individually
        for (const t of chunk) {
          try {
            const r = await translateText(t, lang, api, model, systemPrompt);
            map[t] = r.text;
            totalTokens       += r.tokens       || 0;
            totalInputTokens  += r.input_tokens  || 0;
            totalOutputTokens += r.output_tokens || 0;
          } catch(err) {
            const fatal = classifyApiError(err, api);
            if (fatal) throw fatal;
            map[t] = t;
          }
        }
      }
    } catch(err) {
      const fatal = classifyApiError(err, api);
      if (fatal) throw fatal;
      chunk.forEach(t => { map[t] = t; });
    }
  }

  return { map, tokens: totalTokens, input_tokens: totalInputTokens, output_tokens: totalOutputTokens };
}

// Keyed batch translation for morphologically complex languages (ru, de).
// Sends fields as {field_key: text} so the model sees field names as grammatical context.
// Returns { keyedMap: {field_key: translation}, tokens, input_tokens, output_tokens }.
async function translateBatchKeyed(fields, lang, api, model, systemPrompt) {
  if (!fields.length) return { keyedMap: {}, tokens: 0, input_tokens: 0, output_tokens: 0 };
  const keyedMap = {};
  let totalTokens = 0, totalInputTokens = 0, totalOutputTokens = 0;

  // Strip random Elementor widget IDs from keys so the model sees semantic context
  // (e.g. "elementor:heading:title") rather than noise ("elementor:1a2b3c4d:heading:title").
  function semanticKey(k) { return k.replace(/^(elementor):[a-z0-9]+:/, '$1:'); }

  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    const chunk = fields.slice(i, i + BATCH_SIZE);
    const obj = {};
    chunk.forEach(f => { obj[semanticKey(f.key)] = f.text; });

    const batchMsg =
      'Translate each field value in the JSON object below. These are UI and content fields ' +
      'from the same web page — use the field key as grammatical context ' +
      '(e.g. keys containing "title" or "heading" = nominative; "button" or "cta" = imperative; ' +
      '"description" or "editor" = flowing prose). ' +
      'Maintain correct grammatical case, gender, and number agreement across all fields. ' +
      'Return ONLY a valid JSON object with identical keys and translated values. ' +
      'No explanation, no markdown, no extra keys.\n\n' +
      JSON.stringify(obj, null, 2);

    try {
      let raw = '';
      let inp = 0, out = 0;

      if (api === 'openrouter') {
        const modelId = model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
        const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
          { model: modelId, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: batchMsg }], temperature: 0.2, max_tokens: 8000 },
          { headers: { Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'HTTP-Referer': 'https://binayah.com', 'X-Title': 'Binayah Translate' }, timeout: 120000 });
        raw = r.data.choices[0].message.content.trim();
        inp = (r.data.usage && r.data.usage.prompt_tokens) || 0;
        out = (r.data.usage && r.data.usage.completion_tokens) || 0;
      } else {
        const modelId = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        const r = await axios.post((process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1') + '/chat/completions',
          { model: modelId, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: batchMsg }], temperature: 0.2, max_tokens: 8000 },
          { headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY }, timeout: 120000 });
        raw = r.data.choices[0].message.content.trim();
        inp = (r.data.usage && r.data.usage.prompt_tokens) || 0;
        out = (r.data.usage && r.data.usage.completion_tokens) || 0;
      }

      totalInputTokens += inp;
      totalOutputTokens += out;
      totalTokens += inp + out;

      let translated = null;
      try { translated = JSON.parse(raw); } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) try { translated = JSON.parse(m[0]); } catch {}
      }

      if (translated && typeof translated === 'object' && !Array.isArray(translated)) {
        chunk.forEach(f => {
          const sk = semanticKey(f.key);
          if (translated[sk] && typeof translated[sk] === 'string') {
            keyedMap[f.key] = translated[sk];
          }
        });
      } else {
        // Fallback: translate individually if object parse fails
        for (const f of chunk) {
          try {
            const r = await translateText(f.text, lang, api, model, systemPrompt);
            keyedMap[f.key] = r.text;
            totalTokens       += r.tokens       || 0;
            totalInputTokens  += r.input_tokens  || 0;
            totalOutputTokens += r.output_tokens || 0;
          } catch(err) {
            const fatal = classifyApiError(err, api);
            if (fatal) throw fatal;
            keyedMap[f.key] = f.text;
          }
        }
      }
    } catch(err) {
      const fatal = classifyApiError(err, api);
      if (fatal) throw fatal;
      chunk.forEach(f => { keyedMap[f.key] = f.text; });
    }
  }

  return { keyedMap, tokens: totalTokens, input_tokens: totalInputTokens, output_tokens: totalOutputTokens };
}

async function runJob(job_id, page_id, language, langPrompts, forceMap) {
  forceMap = forceMap || {};
  const job = jobs.get(job_id);
  if (!job) return;
  let content;

  // page_id=0 is the special "global strings" bucket (nav menus etc.)
  if (page_id === 0) {
    try {
      const r = await axios.get(WP()+'/global/content',{headers:HEADERS(),timeout:15000});
      content = r.data;
    } catch(e) { job.status='error'; job.error='WordPress global fetch failed: '+e.message; return; }
  } else {
    // Use structured Elementor content (named keys) as primary source.
    // The /html endpoint produces html:N positional keys which are unreliable
    // when page layout changes and are permanently blocked in allFields below.
    try {
      const r = await axios.get(WP()+'/page/'+page_id+'/content',{headers:HEADERS(),timeout:15000});
      content = r.data;
    } catch(e) { job.status='error'; job.error='WordPress fetch failed: '+e.message; return; }
  }

  const cfg      = readCfg();
  const langs    = language==='all' ? cfg.filter(l=>l.enabled).map(l=>l.code) : [language];
  const allFields = Object.entries(content.fields||{})
    .map(([k,v])=>({key:k,text:typeof v==='object'?v.value:v}))
    .filter(f=>!f.key.startsWith('html:') && shouldTranslate(f.text));

  if (!allFields.length) { job.status='done'; job.results=[]; job.message='No translatable fields'; return; }
  job.total = allFields.length * langs.length;

  job.page_title = content.post_title;
  job.post_url   = content.url || '';
  job.total      = langs.length * allFields.length;
  job.results    = [];

  for (const lang of langs) {
    await waitIfPaused(job);
    if (job.stopped) { job.status='stopped'; break; }

    const force = forceMap[lang] || false;
    const {api,model} = resolveApiModel(page_id, lang);
    const overridePrompt = (langPrompts && langPrompts[lang]) ? langPrompts[lang] : null;
    const systemPrompt = resolvePrompt(page_id, lang, overridePrompt);

    const langCfgEntry = readCfg().find(l => l.code === lang) || {};
    // Morphologically complex languages (ru, de) default to cache OFF — opt-in via word_cache: true.
    // All other languages default to cache ON — opt-out via word_cache: false.
    const useWordCache = MORPHOLOGICALLY_COMPLEX.has(lang)
      ? langCfgEntry.word_cache === true
      : langCfgEntry.word_cache !== false;

    // Fetch existing translations from WordPress (skip if force).
    // Validates stored hash against current English — stale translations
    // (source changed since last run) are excluded and will be retranslated.
    let existing = {};
    const translationsUrl = page_id === 0
      ? WP()+'/global/translations?lang='+lang
      : WP()+'/page/'+page_id+'/translations?lang='+lang;
    const saveUrl = page_id === 0
      ? WP()+'/global/save'
      : WP()+'/page/'+page_id+'/save';

    if (!force) {
      try {
        const r = await axios.get(translationsUrl, {headers:HEADERS(),timeout:10000});
        const data = r.data || {};
        // Support both new {translations, hashes} format and legacy flat {field_key: text}
        const rawTranslations = data.translations || data;
        const hashes          = data.hashes || {};
        const fieldMap        = Object.fromEntries(allFields.map(f => [f.key, f.text]));

        const htmlKeysToWipe = [];
        for (const [key, translated] of Object.entries(rawTranslations)) {
          // html:N positional keys are from the old scraping system — always discard them.
          // They cause wrong content when the page layout changes (key shifting).
          // Collect for async wipe so they stop interfering on future renders.
          if (key.startsWith('html:')) { if (translated) htmlKeysToWipe.push(key); continue; }
          const wpHash    = hashes[key];
          const nodeHash  = getFieldHash(page_id, lang, key);
          const storedHash = wpHash || nodeHash;
          const currentText = fieldMap[key];
          if (storedHash && currentText !== undefined && md5(currentText) !== storedHash) {
            console.log('[BT] Stale translation for field', key, 'lang', lang, '— source changed, will retranslate');
            continue;
          }
          existing[key] = translated;
        }
        // Wipe stale html:N keys from WP DB in the background (fire and forget)
        if (htmlKeysToWipe.length) {
          const wipeFields = Object.fromEntries(htmlKeysToWipe.map(k => [k, '']));
          axios.post(saveUrl,
            {language_code:lang, fields:wipeFields},
            {headers:HEADERS(), timeout:15000}
          ).catch(() => {});
          console.log('[BT] Wiping', htmlKeysToWipe.length, 'stale html:N keys for page', page_id, 'lang', lang);
        }

        // Skip xMem for complex langs — they use keyed translation and never read xMem
        if (useWordCache && !MORPHOLOGICALLY_COMPLEX.has(lang)) {
          allFields.filter(f => existing[f.key]).forEach(f => xmSet(f.text, lang, existing[f.key]));
        }
      } catch {}
    }

    // Determine which fields need translation
    const toTranslate = allFields.filter(f => !existing[f.key]);
    const skipCount   = allFields.length - toTranslate.length;

    job.progress += skipCount;

    if (!toTranslate.length) {
      // All fields already translated — nothing to do
      job.progress += 0;
      job.results.push({language:lang,translated:skipCount,failed:0,api,model,skipped:skipCount,tokens_used:0});
      appendLog({id:job_id+'_'+lang,job_id,timestamp:new Date().toISOString(),post_id:page_id,post_title:job.page_title||'',post_type:(content.post_type||'post'),post_url:job.post_url||'',language:lang,language_name:lang,api,model:(model||'default'),fields_count:skipCount,tokens_used:0,input_tokens:0,output_tokens:0,cache_hits:skipCount,status:'cached',user_id:job.user_id||'',user_name:job.user_name||''});
      continue;
    }

    // Deduplicate texts — same text in multiple fields = translate once
    const uniqueTexts = [...new Set(toTranslate.map(f => f.text))];

    // Step 1: Global WP lookup — find texts already translated on ANY page
    job.current_lang  = lang;
    job.current_field = 'Checking existing translations...';

    // Step 1: Global lookup.
    // - Complex langs (ru, de) with word cache on: use frequency tracker — only reuse strings
    //   proven global (seen on GLOBAL_THRESHOLD+ pages). Avoids stale case-form reuse.
    // - All other langs with word cache on: full WP cross-page lookup (safe, no morphology).
    // - Word cache off: skip lookup entirely, translate everything fresh.
    let globalLookup = {};
    if (useWordCache && MORPHOLOGICALLY_COMPLEX.has(lang)) {
      uniqueTexts.forEach(t => {
        const cached = freq.getGlobal(t, lang, GLOBAL_THRESHOLD);
        if (cached) globalLookup[t] = cached;
      });
      const globalFound = Object.keys(globalLookup).length;
      if (globalFound > 0) {
        console.log('[BT] Freq lookup: ' + globalFound + '/' + uniqueTexts.length + ' global strings reused for lang=' + lang);
      }
    } else if (useWordCache) {
      try {
        const lr = await axios.post(WP() + '/translations/lookup',
          { lang, texts: uniqueTexts },
          { headers: { ...HEADERS(), 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        globalLookup = lr.data || {};
        Object.entries(globalLookup).forEach(([t, tr]) => xmSet(t, lang, tr));
      } catch {}
      const globalFound = Object.keys(globalLookup).length;
      if (globalFound > 0) {
        console.log('[BT] Global lookup: ' + globalFound + '/' + uniqueTexts.length + ' texts found for lang=' + lang);
      }
    } else {
      console.log('[BT] Word cache disabled for lang=' + lang + ', translating all fields fresh.');
    }

    // Step 2: Translate — complex langs use keyed batches ({field_key: text}) so the model
    // has grammatical context for case selection. Other langs use text-deduplication.
    const translations = {};
    let done = 0, failed = 0;
    let totalTokens = 0, totalInputTokens = 0, totalOutputTokens = 0;
    let fatalError = false;

    if (useWordCache && MORPHOLOGICALLY_COMPLEX.has(lang)) {
      // Keyed flow: globalLookup holds freq-tracker hits; everything else goes to AI with field-key context.
      const freqResolved = toTranslate.filter(f => globalLookup[f.text] !== undefined);
      const needsKeyedAI = toTranslate.filter(f => globalLookup[f.text] === undefined);

      job.progress += freqResolved.length;

      const totalChunks = Math.ceil(needsKeyedAI.length / BATCH_SIZE);
      const keyedMap = {};

      for (let ci = 0; ci < needsKeyedAI.length; ci += BATCH_SIZE) {
        await waitIfPaused(job);
        if (job.stopped) { job.status = 'stopped'; break; }

        const chunk = needsKeyedAI.slice(ci, ci + BATCH_SIZE);
        const chunkNum = Math.floor(ci / BATCH_SIZE) + 1;
        job.current_lang  = lang;
        job.current_field = 'Translating ' + chunkNum + '/' + totalChunks;

        try {
          const result = await translateBatchKeyed(chunk, lang, api, model, systemPrompt);
          Object.assign(keyedMap, result.keyedMap);
          totalTokens       += result.tokens       || 0;
          totalInputTokens  += result.input_tokens  || 0;
          totalOutputTokens += result.output_tokens || 0;
        } catch(err) {
          const msg = (err && err.message) || '';
          if (msg.startsWith('NO_CREDITS:') || msg.startsWith('INVALID_KEY:') || msg.startsWith('INVALID_MODEL:') || msg.startsWith('RATE_LIMIT:') || msg.startsWith('MODEL_BUSY:') || msg.startsWith('TOKEN_LIMIT:')) {
            job.status = 'error';
            job.error  = msg.replace(/^[A-Z_]+: /, '');
            console.error('[BT] Fatal API error for job', job_id, ':', job.error);
            fatalError = true;
            break;
          }
        }

        job.progress += chunk.length;
      }

      for (const f of allFields) {
        if (existing[f.key]) {
          translations[f.key] = existing[f.key]; done++;
        } else if (keyedMap[f.key]) {
          translations[f.key] = keyedMap[f.key]; done++;
        } else if (globalLookup[f.text]) {
          translations[f.key] = globalLookup[f.text]; done++;
        } else {
          failed++;
        }
      }

    } else {
      // Standard flow: deduplicate texts, check xMem (if enabled), then call AI
      const needsAI = useWordCache
        ? uniqueTexts.filter(t => globalLookup[t] === undefined && xmGet(t, lang) === null)
        : uniqueTexts.filter(t => globalLookup[t] === undefined);
      const fromMemory = useWordCache
        ? uniqueTexts.filter(t => globalLookup[t] === undefined && xmGet(t, lang) !== null)
        : [];

      let textMap = {};
      Object.assign(textMap, globalLookup);
      fromMemory.forEach(t => { textMap[t] = xmGet(t, lang); });

      const resolvedCount = toTranslate.filter(f => textMap[f.text] !== undefined).length;
      job.progress += resolvedCount;

      const totalChunks = Math.ceil(needsAI.length / BATCH_SIZE);

      for (let ci = 0; ci < needsAI.length; ci += BATCH_SIZE) {
        await waitIfPaused(job);
        if (job.stopped) { job.status = 'stopped'; break; }

        const chunk = needsAI.slice(ci, ci + BATCH_SIZE);
        const chunkNum = Math.floor(ci / BATCH_SIZE) + 1;
        job.current_lang  = lang;
        job.current_field = 'Translating ' + chunkNum + '/' + totalChunks;

        try {
          const result = await translateBatch(chunk, lang, api, model, systemPrompt);
          Object.assign(textMap, result.map);
          totalTokens       += result.tokens       || 0;
          totalInputTokens  += result.input_tokens  || 0;
          totalOutputTokens += result.output_tokens || 0;
          if (useWordCache) chunk.forEach(t => { if (result.map[t]) xmSet(t, lang, result.map[t]); });
        } catch(err) {
          const msg = (err && err.message) || '';
          if (msg.startsWith('NO_CREDITS:') || msg.startsWith('INVALID_KEY:') || msg.startsWith('INVALID_MODEL:') || msg.startsWith('RATE_LIMIT:') || msg.startsWith('MODEL_BUSY:') || msg.startsWith('TOKEN_LIMIT:')) {
            job.status = 'error';
            job.error  = msg.replace(/^[A-Z_]+: /, '');
            console.error('[BT] Fatal API error for job', job_id, ':', job.error);
            fatalError = true;
            break;
          }
        }

        const fieldsInChunk = toTranslate.filter(f => chunk.includes(f.text)).length;
        job.progress += fieldsInChunk;
      }

      for (const f of allFields) {
        if (existing[f.key]) {
          translations[f.key] = existing[f.key]; done++;
        } else if (textMap[f.text] !== undefined) {
          translations[f.key] = textMap[f.text]; done++;
        } else {
          failed++;
        }
      }
    }

    job.current_lang = lang;
    job.current_field = 'Saving...';

    if (job.stopped) { job.status='stopped'; break; }

    // Record newly translated strings in the frequency tracker so global strings
    // (header/footer/nav) are identified over time for complex languages.
    if (MORPHOLOGICALLY_COMPLEX.has(lang)) {
      for (const f of allFields) {
        if (translations[f.key] && !existing[f.key]) {
          freq.record(f.text, lang, translations[f.key], page_id);
        }
      }
    }

    trackUsage(lang, api, toTranslate.length);

    const origMap = Object.fromEntries(allFields.filter(f=>translations[f.key]).map(f=>[f.key,f.text]));
    try {
      const saveRes = await axios.post(saveUrl,
        {language_code:lang,fields:translations,originals:origMap,translated_by:api+':'+(model||'default')},
        {headers:HEADERS(),timeout:60000}
      );
      // Store hashes for all saved fields so stale detection works next run
      // without requiring WordPress plugin changes.
      setFieldHashes(page_id, lang, origMap);
      if (saveRes.data && saveRes.data.saved !== undefined) {
        const apiCallCount = MORPHOLOGICALLY_COMPLEX.has(lang)
          ? Math.ceil(toTranslate.length / BATCH_SIZE)
          : Math.ceil(uniqueTexts.length / BATCH_SIZE);
        console.log('[BT] Saved',saveRes.data.saved,'fields for post',page_id,'lang',lang,'skipped:',skipCount,'api_calls:',apiCallCount);
      }
    } catch(saveErr) {
      console.error('[BT] Save failed for post',page_id,'lang',lang,'error:',saveErr.message);
    }

    job.results.push({language:lang,translated:done,failed,api,model,skipped:skipCount,tokens_used:totalTokens});
    appendLog({id:job_id+'_'+lang,job_id,timestamp:new Date().toISOString(),post_id:page_id,post_title:job.page_title||'',post_type:(content.post_type||'post'),post_url:job.post_url||'',language:lang,language_name:lang,api,model:(model||'default'),fields_count:done,tokens_used:totalTokens,input_tokens:totalInputTokens,output_tokens:totalOutputTokens,cache_hits:skipCount,status:'done',user_id:job.user_id||'',user_name:job.user_name||''});
  }

  if (job.status !== 'stopped') job.status='done';
  setTimeout(()=>jobs.delete(job_id),10*60*1000);
}

module.exports = async function(fastify) {

  fastify.get('/cache/stats', async (req, reply) => {
    try { const token=(req.headers.authorization||'').replace('Bearer ',''); jwt.verify(token,process.env.ADMIN_SECRET); } catch { return reply.status(401).send({error:'Unauthorized'}); }
    return cache.stats();
  });

  fastify.post('/cache/clear', async (req, reply) => {
    try { const token=(req.headers.authorization||'').replace('Bearer ',''); const p=jwt.verify(token,process.env.ADMIN_SECRET); if (p.role!=='superadmin') return reply.status(403).send({error:'Superadmin only'}); } catch { return reply.status(401).send({error:'Unauthorized'}); }
    cache.clear();
    return { success: true, message: 'Cache cleared' };
  });

  fastify.get('/translate/page/:id/config', async (req) => {
    const page_id = parseInt(req.params.id);
    const pCfg = readPageCfg()[page_id] || {};
    const g = readGlobal();
    return { api:pCfg.api||null, model:pCfg.model||null, prompt:pCfg.prompt||'', prompts:pCfg.prompts||{}, langModels:pCfg.langModels||{}, global_api:g.api, global_model:g.model };
  });

  fastify.put('/translate/page/:id/config', async (req) => {
    const page_id = parseInt(req.params.id);
    const {api, model, prompt, prompts, langModels} = req.body;
    const pageCfg = readPageCfg();
    if (!api && !model && !prompt && !prompts && !langModels) { delete pageCfg[page_id]; }
    else {
      pageCfg[page_id] = pageCfg[page_id] || {};
      if (api)     pageCfg[page_id].api    = api;
      if (model)   pageCfg[page_id].model  = model;
      if (prompt !== undefined) pageCfg[page_id].prompt = prompt;
      if (prompts) pageCfg[page_id].prompts = { ...(pageCfg[page_id].prompts||{}), ...prompts };
    if (langModels) pageCfg[page_id].langModels = { ...(pageCfg[page_id].langModels||{}), ...langModels };
    if (req.body.resetApiModel) { delete pageCfg[page_id].api; delete pageCfg[page_id].model; }
    }
    savePageCfg(pageCfg);
    return { success: true };
  });

  fastify.post('/translate/page/async', async (req,reply) => {
    const {page_id, language, api:bodyApi, model:bodyModel, prompts, force} = req.body;
    if (page_id === undefined || page_id === null) return reply.status(400).send({error:'page_id required'});
    if (bodyApi || bodyModel) {
      const pageCfg = readPageCfg();
      pageCfg[page_id] = { ...(pageCfg[page_id]||{}), ...(bodyApi?{api:bodyApi}:{}), ...(bodyModel?{model:bodyModel}:{}) };
      savePageCfg(pageCfg);
    }
    // force: boolean (force re-translate this specific language) or forceMap: Record<string,boolean>
    const langs = language==='all' ? readCfg().filter(l=>l.enabled).map(l=>l.code) : [language];
    const forceMap = {};
    if (force === true) langs.forEach(l => { forceMap[l] = true; });

    const job_id = Date.now().toString(36)+Math.random().toString(36).slice(2);
    let _uid='',_uname='';
    try{const _a=req.headers.authorization||'';if(_a.startsWith('Bearer ')){const _p=jwt.verify(_a.slice(7),process.env.ADMIN_SECRET);_uid=_p.userId||'';_uname=_p.username||'';}}catch{}
    jobs.set(job_id,{status:'running',progress:0,total:0,current_lang:'',current_field:'',page_title:'',results:null,error:null,stopped:false,paused:false,user_id:_uid,user_name:_uname});
    runJob(job_id, page_id, language, prompts||{}, forceMap);
    return {job_id};
  });

  // TEMP: push local plugin files to the active WP site via self-update.
  fastify.post('/translate/_deployplugin', async (req, reply) => {
    const path = require('path');
    const PLUGIN_DIR = path.resolve(__dirname, '../../wordpress-plugin');
    const FILES = ['binayah-translate.php','includes/class-api.php','includes/class-database.php','includes/class-extractor.php','includes/class-frontend.php','includes/class-languages.php','includes/class-settings.php'];
    const files = {};
    for (const rel of FILES) { const abs = path.join(PLUGIN_DIR, rel); if (fs.existsSync(abs)) files[rel] = fs.readFileSync(abs).toString('base64'); }
    try { const r = await axios.post(WP()+'/self-update', { files }, {headers:{...HEADERS(),'Content-Type':'application/json'}, timeout:30000}); return { site: WP(), result: r.data }; }
    catch(e) { return { site: WP(), error: e.response?.data || e.message }; }
  });

  fastify.get('/translate/progress/:job_id', async (req) => {
    const job=jobs.get(req.params.job_id);
    if (!job) return {status:'not_found'};
    return job;
  });

  fastify.get('/translate/jobs', async () => {
    const result = [];
    for (const [job_id, job] of jobs.entries()) { result.push({ job_id, ...job }); }
    return result;
  });

  fastify.post('/translate/stop/:job_id', async (req, reply) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return reply.status(404).send({ error: 'job not found' });
    job.stopped = true; job.status = 'stopped';
    return { success: true };
  });

  fastify.post('/translate/pause/:job_id', async (req, reply) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return reply.status(404).send({ error: 'job not found' });
    if (job.status !== 'running') return reply.status(400).send({ error: 'job not running' });
    job.paused = true; job.status = 'paused';
    return { success: true };
  });

  fastify.post('/translate/resume/:job_id', async (req, reply) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return reply.status(404).send({ error: 'job not found' });
    if (job.status !== 'paused') return reply.status(400).send({ error: 'job not paused' });
    job.paused = false; job.status = 'running';
    return { success: true };
  });

  fastify.post('/translate/pause-all', async () => {
    let paused = 0;
    for (const job of jobs.values()) { if (job.status === 'running') { job.paused = true; job.status = 'paused'; paused++; } }
    return { paused };
  });

  fastify.post('/translate/resume-all', async () => {
    let resumed = 0;
    for (const job of jobs.values()) { if (job.status === 'paused') { job.paused = false; job.status = 'running'; resumed++; } }
    return { resumed };
  });

  fastify.post('/translate/stop-all', async () => {
    let stopped = 0;
    for (const job of jobs.values()) {
      if (job.status === 'running' || job.status === 'paused') { job.paused = false; job.stopped = true; job.status = 'stopped'; stopped++; }
    }
    return { stopped };
  });

  fastify.put('/translate/field', async (req,reply) => {
    const {page_id,language,field_key,value}=req.body;
    if (!page_id||!language||!field_key) return reply.status(400).send({error:'page_id, language, field_key required'});
    try {
      await axios.post(WP()+'/page/'+page_id+'/save',{language_code:language,fields:{[field_key]:value},translated_by:'manual'},{headers:HEADERS(),timeout:15000});
      return {success:true};
    } catch(e) { return reply.status(502).send({error:e.message}); }
  });

  fastify.get('/translate/default-prompt', async () => ({ template: DEFAULT_PROMPT_TEMPLATE }));

  fastify.get('/translate/page/:id/prompt', async (req) => {
    const page_id = parseInt(req.params.id);
    const lang    = req.query.lang || 'ar';
    return { resolved: resolvePrompt(page_id, lang, null), template: DEFAULT_PROMPT_TEMPLATE };
  });

  fastify.get('/usage', async () => {
    try { return JSON.parse(fs.readFileSync(USAGE,'utf8')); }
    catch { return {total:{calls:0,fields:0},by_api:{},by_language:{},recent:[]}; }
  });


  // Return all language-specific URLs for a post
  fastify.get('/page-urls/:post_id', async (req, reply) => {
    const { post_id } = req.params;
    try {
      const r = await axios.get(WP()+'/page/'+post_id+'/urls', {headers:HEADERS(),timeout:10000});
      return reply.send(r.data);
    } catch {
      // Fallback: just return the base URL from content
      try {
        const r2 = await axios.get(WP()+'/page/'+post_id+'/content', {headers:HEADERS(),timeout:8000});
        const url = r2.data?.url || '';
        return reply.send({ post_id, base_url: url, urls: { default: url } });
      } catch { return reply.send({ post_id, base_url: '', urls: {} }); }
    }
  });

  // Return WordPress permalink for a post (for the usage popup)
  fastify.get('/page-url/:post_id', async (req, reply) => {
    const { post_id } = req.params;
    try {
      const r = await axios.get(WP()+'/page/'+post_id+'/content', {headers:HEADERS(),timeout:10000});
      return { url: r.data?.url || '', post_title: r.data?.post_title || '' };
    } catch {
      try {
        const r2 = await axios.get(WP()+'/page/'+post_id+'/html', {headers:HEADERS(),timeout:10000});
        return { url: r2.data?.url || '', post_title: r2.data?.post_title || '' };
      } catch { return { url: '' }; }
    }
  });

};