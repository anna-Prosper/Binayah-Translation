'use strict';
const axios = require('axios');
const jwt   = require('jsonwebtoken');
const fs    = require('fs');
const path  = require('path');

const WP      = () => process.env.WP_URL + '/wp-json/btranslate/v1';
const HEADERS = () => ({ 'X-Binayah-API-Key': process.env.WP_API_KEY });
const CFG        = path.join(__dirname, '../language-config.json');
const USAGE      = path.join(__dirname, '../usage-stats.json');
const GLOBAL_CFG = path.join(__dirname, '../global-config.json');
const PAGE_CFG   = path.join(__dirname, '../page-config.json');
const TRANS_LOG  = path.join(__dirname, '../translation-log.json');

const readCfg     = () => { try { return JSON.parse(fs.readFileSync(CFG,'utf8')); } catch { return []; } };
const readGlobal  = () => { try { return JSON.parse(fs.readFileSync(GLOBAL_CFG,'utf8')); } catch { return {api:'deepseek',model:'deepseek-chat'}; } };
const readPageCfg = () => { try { return JSON.parse(fs.readFileSync(PAGE_CFG,'utf8')); } catch { return {}; } };
const savePageCfg = (d) => fs.writeFileSync(PAGE_CFG, JSON.stringify(d,null,2));

function resolveApiModel(page_id, lang) {
  const g    = readGlobal();
  const lCfg = readCfg().find(l => l.code===lang) || {};
  const pCfg = readPageCfg()[page_id] || {};
  const api    = pCfg.api   || lCfg.api   || g.api   || 'deepseek';
  const defMdl = api==='openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
  const model  = pCfg.model || lCfg.model || g.model || defMdl;
  return { api, model };
}

function appendLog(entry) {
  try {
    const logs = fs.existsSync(TRANS_LOG) ? JSON.parse(fs.readFileSync(TRANS_LOG,"utf8")) : [];
    logs.unshift(entry);
    if (logs.length > 5000) logs.splice(5000);
    fs.writeFileSync(TRANS_LOG, JSON.stringify(logs));
  } catch(e) {}
}

const jobs = new Map();

async function waitIfPaused(job) {
  while (job.paused && !job.stopped) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

const NEVER_TRANSLATE = new Set([
  'BINAYAH','Binayah','Bayut','Property Finder','Dubizzle',
  'UAE','Dubai','Dubailand','Abu Dhabi','Sharjah','Ajman','RAK','Fujairah','Umm Al Quwain',
  'DIFC','JBR','JVC','JLT','IMPZ','SZR','DIP','DHCC','DMC','JVT','JAFZA',
  'Deira','Bur Dubai','Karama','Satwa','Tecom',
  'Arabian Ranches','Arabian Ranches 2','Arabian Ranches 3',
  'Arjan','Jumeirah','Mirdif','Meydan','Meadows','Springs','Greens','Views',
  'Mudon','Serena','Remraam','Liwan','Majan','Reem','Zabeel',
  'Downtown Dubai','Business Bay','Dubai Marina','Palm Jumeirah',
  'Dubai Hills','Dubai Hills Estate','Creek Harbour','Dubai Creek Harbour',
  'Al Barsha','Al Furjan','Al Quoz','Al Rashidiya','Al Warqa','Al Nahda',
  'International City','Motor City','Sports City','Academic City',
  'Damac Hills','Damac Hills 2','Emaar Beachfront','Emaar',
  'AED','sqft','sqm',
]);

function isAIMetaResponse(text) {
  if (!text || text.length < 10) return false;
  const lower = text.toLowerCase();
  const bad = [
    "i'd be happy to help","i'm happy to help","i cannot translate","i'm unable to",
    "haven't provided","please provide the","could you please share",
    "no content to translate","as an ai","i'm an ai",
    "what would you like me to translate","you haven't provided","provide the content you",
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
  if (NEVER_TRANSLATE.has(t)) return false;
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
  'You are a professional UAE real estate translator. Translate to {language}.\n' +
  'STRICT RULES:\n' +
  '- Return ONLY the translated text, no explanations or meta-commentary.\n' +
  '- Preserve ALL HTML tags exactly as written.\n' +
  '- Do NOT translate: URLs, email addresses, file/image paths.\n' +
  '- Do NOT translate: brand names (Binayah, Bayut, Property Finder, Dubizzle).\n' +
  '- Do NOT translate: UAE emirate/city names (Dubai, Abu Dhabi, Sharjah, Ajman, RAK, Fujairah).\n' +
  '- Do NOT translate: Dubai community/area names (DIFC, JBR, JVC, JLT, Arabian Ranches, Palm Jumeirah, Downtown Dubai, Business Bay, Dubai Marina, Jumeirah, Meydan, Meadows, Springs, Greens, Damac Hills, and all similar proper place names).\n' +
  '- Do NOT translate: abbreviations and codes (AED, UAE, sqft, sqm, IMPZ, SZR, DIP).\n' +
  '- If the input is a single proper noun, place name, or acronym - return it unchanged.\n' +
  '- For Arabic or Persian output: write naturally right-to-left.';

const LANG_NAMES_FULL = {ar:'Arabic',he:'Hebrew',fa:'Persian',fr:'French',es:'Spanish',de:'German',ru:'Russian',zh:'Chinese (Simplified)',hi:'Hindi',it:'Italian',pt:'Portuguese',tr:'Turkish',ja:'Japanese',ko:'Korean',nl:'Dutch',sv:'Swedish',pl:'Polish',uk:'Ukrainian',da:'Danish',fi:'Finnish',nb:'Norwegian',cs:'Czech',hu:'Hungarian',ro:'Romanian',bg:'Bulgarian',hr:'Croatian',sk:'Slovak',sl:'Slovenian',et:'Estonian',lv:'Latvian',lt:'Lithuanian',el:'Greek',vi:'Vietnamese',th:'Thai',id:'Indonesian',ms:'Malay'};

function buildSystemPrompt(lang, template) {
  const langName = LANG_NAMES_FULL[lang] || lang;
  const tpl = (template && template.trim()) ? template.trim() : DEFAULT_PROMPT_TEMPLATE;
  return tpl.replace(/\{language\}/gi, langName);
}

function resolvePrompt(page_id, lang, overridePrompt) {
  if (overridePrompt && overridePrompt.trim()) return buildSystemPrompt(lang, overridePrompt);
  const pageCfg = readPageCfg()[page_id] || {};
  if (pageCfg.prompt && pageCfg.prompt.trim()) return buildSystemPrompt(lang, pageCfg.prompt);
  const globalCfg = readGlobal();
  if (globalCfg.prompt && globalCfg.prompt.trim()) return buildSystemPrompt(lang, globalCfg.prompt);
  return buildSystemPrompt(lang, DEFAULT_PROMPT_TEMPLATE);
}

const NAMES = {ar:'Arabic',fr:'French',es:'Spanish',de:'German',ru:'Russian',zh:'Chinese (Simplified)',it:'Italian',pt:'Portuguese',fa:'Persian',hi:'Hindi'};

async function translateText(text, lang, api, model, systemPrompt) {
  if (!shouldTranslate(text)) return { text, tokens: 0 };
  const langName = NAMES[lang] || lang;
  const prompt = 'You are a professional UAE real estate translator. Translate to ' + langName + '.\n' +
    'STRICT RULES:\n' +
    '- Return ONLY the translated text, no explanations or meta-commentary.\n' +
    '- Preserve ALL HTML tags exactly as written.\n' +
    '- Do NOT translate: URLs, email addresses, file/image paths.\n' +
    '- Do NOT translate: brand names (Binayah, Bayut, Property Finder, Dubizzle).\n' +
    '- Do NOT translate: UAE emirate/city names (Dubai, Abu Dhabi, Sharjah, Ajman, RAK, Fujairah).\n' +
    '- Do NOT translate: Dubai community/area names (DIFC, JBR, JVC, JLT, Arabian Ranches, Palm Jumeirah, Downtown Dubai, Business Bay, Dubai Marina, Jumeirah, Meydan, Meadows, Springs, Greens, Damac Hills, and all similar proper place names).\n' +
    '- Do NOT translate: abbreviations and codes (AED, UAE, sqft, sqm, IMPZ, SZR, DIP).\n' +
    '- If the input is a single proper noun, place name, or acronym - return it unchanged.\n' +
    '- For Arabic or Persian output: write naturally right-to-left.';

  if (api==='openrouter') {
    const modelId = model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const r = await axios.post('https://openrouter.ai/api/v1/chat/completions',
      {model:modelId,messages:[{role:'system',content:prompt},{role:'user',content:text}],temperature:0.3,max_tokens:2000},
      {headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY,'HTTP-Referer':'https://binayah.com','X-Title':'Binayah Translate'},timeout:30000});
    const resOR = r.data.choices[0].message.content.trim();
    const tokensOR = (r.data.usage && r.data.usage.total_tokens) ? r.data.usage.total_tokens : 0;
    if (isAIMetaResponse(resOR)) return { text, tokens: 0 };
    return { text: resOR, tokens: tokensOR };
  }
  const modelId = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const r = await axios.post((process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com/v1')+'/chat/completions',
    {model:modelId,messages:[{role:'system',content:prompt},{role:'user',content:text}],temperature:0.3,max_tokens:2000},
    {headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},timeout:30000});
  const resDS = r.data.choices[0].message.content.trim();
  const tokensDS = (r.data.usage && r.data.usage.total_tokens) ? r.data.usage.total_tokens : 0;
  if (isAIMetaResponse(resDS)) return { text, tokens: 0 };
  return { text: resDS, tokens: tokensDS };
}

async function runJob(job_id, page_id, language, langPrompts) {
  const job = jobs.get(job_id);
  if (!job) return;
  let content;
  try {
    const r = await axios.get(WP()+'/page/'+page_id+'/html',{headers:HEADERS(),timeout:30000});
    content = r.data;
  } catch(e) {
    try {
      const r2 = await axios.get(WP()+'/page/'+page_id+'/content',{headers:HEADERS(),timeout:15000});
      content = r2.data;
    } catch(e2) { job.status='error'; job.error='WordPress fetch failed: '+e2.message; return; }
  }

  const cfg   = readCfg();
  const langs = language==='all' ? cfg.filter(l=>l.enabled).map(l=>l.code) : [language];
  const fields= Object.entries(content.fields||{})
    .map(([k,v])=>({key:k,text:typeof v==='object'?v.value:v}))
    .filter(f=>shouldTranslate(f.text));

  if (!fields.length) { job.status='done'; job.results=[]; job.message='No translatable fields'; return; }

  job.page_title = content.post_title;
  job.total      = langs.length * fields.length;
  job.results    = [];

  for (const lang of langs) {
    await waitIfPaused(job);
    if (job.stopped) { job.status='stopped'; break; }
    const {api,model} = resolveApiModel(page_id, lang);
    const overridePrompt = (langPrompts && langPrompts[lang]) ? langPrompts[lang] : null;
    const systemPrompt = resolvePrompt(page_id, lang, overridePrompt);
    const translations={}; let done=0,failed=0,totalTokens=0;
    for (const f of fields) {
      await waitIfPaused(job);
      if (job.stopped) { job.status='stopped'; break; }
      job.current_lang=lang; job.current_field=f.key;
      try { const tr=await translateText(f.text,lang,api,model,systemPrompt); translations[f.key]=tr.text; done++; totalTokens+=tr.tokens||0; }
      catch { failed++; }
      job.progress++;
    }
    if (job.stopped) { job.status='stopped'; break; }
    trackUsage(lang,api,done);
    const origMap=Object.fromEntries(fields.filter(f=>translations[f.key]).map(f=>[f.key,f.text]));
    try {
      const saveRes = await axios.post(WP()+'/page/'+page_id+'/save',
        {language_code:lang,fields:translations,originals:origMap,translated_by:api+':'+(model||'default')},
        {headers:HEADERS(),timeout:60000}
      );
      if (saveRes.data && saveRes.data.saved !== undefined) {
        console.log('[BT] Saved',saveRes.data.saved,'fields for post',page_id,'lang',lang);
      }
    } catch(saveErr) {
      console.error('[BT] Save failed for post',page_id,'lang',lang,'error:',saveErr.message);
    }
    job.results.push({language:lang,translated:done,failed,api,model});
    appendLog({id:job_id+"_"+lang,timestamp:new Date().toISOString(),post_id:page_id,post_title:job.page_title||"",post_type:(content.post_type||"post"),language:lang,language_name:lang,api:api,model:(model||"default"),fields_count:done,tokens_used:totalTokens,status:"done",user_id:job.user_id||"",user_name:job.user_name||""});
  }
  if (job.status !== 'stopped') job.status='done';
  setTimeout(()=>jobs.delete(job_id),10*60*1000);
}

module.exports = async function(fastify) {

  fastify.get('/translate/page/:id/config', async (req) => {
    const page_id = parseInt(req.params.id);
    const pCfg = readPageCfg()[page_id] || {};
    const g = readGlobal();
    return {
      api:          pCfg.api   || null,
      model:        pCfg.model || null,
      global_api:   g.api,
      global_model: g.model,
    };
  });

  fastify.put('/translate/page/:id/config', async (req) => {
    const page_id = parseInt(req.params.id);
    const {api, model} = req.body;
    const pageCfg = readPageCfg();
    if (!api && !model) {
      delete pageCfg[page_id];
    } else {
      pageCfg[page_id] = {};
      if (api)   pageCfg[page_id].api   = api;
      if (model) pageCfg[page_id].model = model;
    }
    savePageCfg(pageCfg);
    return { success: true };
  });

  fastify.post('/translate/page', async (req,reply) => {
    const {page_id,language}=req.body;
    if (!page_id) return reply.status(400).send({error:'page_id required'});
    const langs = language==='all' ? readCfg().filter(l=>l.enabled).map(l=>l.code) : [language];
    let content;
    try { const r=await axios.get(WP()+'/page/'+page_id+'/content',{headers:HEADERS(),timeout:15000}); content=r.data; }
    catch(e) { return reply.status(502).send({error:'WordPress fetch failed',detail:e.message}); }
    const fields=Object.entries(content.fields||{}).map(([k,v])=>({key:k,text:typeof v==='object'?v.value:v})).filter(f=>shouldTranslate(f.text));
    if (!fields.length) return {success:true,message:'No translatable fields',translated:0};
    const results=[];
    for (const lang of langs) {
      const {api,model}=resolveApiModel(page_id,lang);
      const translations={}; let done=0,failed=0;
      for (const f of fields) {
        try { translations[f.key]=await translateText(f.text,lang,api,model,systemPrompt); done++; } catch { failed++; }
      }
      trackUsage(lang,api,done);
      const origMap=Object.fromEntries(fields.filter(f=>translations[f.key]).map(f=>[f.key,f.text]));
      try {
      const saveRes = await axios.post(WP()+'/page/'+page_id+'/save',
        {language_code:lang,fields:translations,originals:origMap,translated_by:api+':'+(model||'default')},
        {headers:HEADERS(),timeout:60000}
      );
      if (saveRes.data && saveRes.data.saved !== undefined) {
        console.log('[BT] Saved',saveRes.data.saved,'fields for post',page_id,'lang',lang);
      }
    } catch(saveErr) {
      console.error('[BT] Save failed for post',page_id,'lang',lang,'error:',saveErr.message);
    }
      results.push({language:lang,translated:done,failed,api,model});
    }
    return {success:true,page_id,page_title:content.post_title,results,total_fields:fields.length};
  });

  fastify.post('/translate/page/async', async (req,reply) => {
    const {page_id,language,api:bodyApi,model:bodyModel,prompts}=req.body;
    if (!page_id) return reply.status(400).send({error:'page_id required'});
    if (bodyApi || bodyModel) {
      const pageCfg = readPageCfg();
      pageCfg[page_id] = {
        ...(pageCfg[page_id]||{}),
        ...(bodyApi   ? {api:   bodyApi}   : {}),
        ...(bodyModel ? {model: bodyModel} : {}),
      };
      savePageCfg(pageCfg);
    }
    const job_id=Date.now().toString(36)+Math.random().toString(36).slice(2);
    let _uid='',_uname='';
    try{const _a=req.headers.authorization||'';if(_a.startsWith('Bearer ')){const _p=jwt.verify(_a.slice(7),process.env.ADMIN_SECRET);_uid=_p.userId||'';_uname=_p.username||'';}}catch{}
    jobs.set(job_id,{status:'running',progress:0,total:0,current_lang:'',current_field:'',page_title:'',results:null,error:null,stopped:false,paused:false,user_id:_uid,user_name:_uname});
    runJob(job_id,page_id,language,prompts||{});
    return {job_id};
  });

  fastify.get('/translate/progress/:job_id', async (req) => {
    const job=jobs.get(req.params.job_id);
    if (!job) return {status:'not_found'};
    return job;
  });

  fastify.get('/translate/jobs', async () => {
    const result = [];
    for (const [job_id, job] of jobs.entries()) {
      result.push({ job_id, ...job });
    }
    return result;
  });

  fastify.post('/translate/stop/:job_id', async (req, reply) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return reply.status(404).send({ error: 'job not found' });
    job.stopped = true;
    job.status = 'stopped';
    return { success: true };
  });

  fastify.post('/translate/pause/:job_id', async (req, reply) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return reply.status(404).send({ error: 'job not found' });
    if (job.status !== 'running') return reply.status(400).send({ error: 'job not running' });
    job.paused = true;
    job.status = 'paused';
    return { success: true };
  });

  fastify.post('/translate/resume/:job_id', async (req, reply) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return reply.status(404).send({ error: 'job not found' });
    if (job.status !== 'paused') return reply.status(400).send({ error: 'job not paused' });
    job.paused = false;
    job.status = 'running';
    return { success: true };
  });

  fastify.post('/translate/pause-all', async () => {
    let paused = 0;
    for (const job of jobs.values()) {
      if (job.status === 'running') { job.paused = true; job.status = 'paused'; paused++; }
    }
    return { paused };
  });

  fastify.post('/translate/resume-all', async () => {
    let resumed = 0;
    for (const job of jobs.values()) {
      if (job.status === 'paused') { job.paused = false; job.status = 'running'; resumed++; }
    }
    return { resumed };
  });

  fastify.post('/translate/stop-all', async () => {
    let stopped = 0;
    for (const job of jobs.values()) {
      if (job.status === 'running' || job.status === 'paused') {
        job.paused = false;
        job.stopped = true;
        job.status = 'stopped';
        stopped++;
      }
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

  // Expose default prompt template to frontend
  fastify.get('/translate/default-prompt', async () => ({
    template: DEFAULT_PROMPT_TEMPLATE,
  }));

  // Resolve prompt for a specific page+lang (for prompt preview)
  fastify.get('/translate/page/:id/prompt', async (req) => {
    const page_id = parseInt(req.params.id);
    const lang    = req.query.lang || 'ar';
    return {
      resolved: resolvePrompt(page_id, lang, null),
      template: DEFAULT_PROMPT_TEMPLATE,
    };
  });

  fastify.get('/usage', async () => {
    try { return JSON.parse(fs.readFileSync(USAGE,'utf8')); }
    catch { return {total:{calls:0,fields:0},by_api:{},by_language:{},recent:[]}; }
  });
};
