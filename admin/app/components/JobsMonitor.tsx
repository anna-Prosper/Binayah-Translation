'use client';
import { useEffect, useState, useRef } from 'react';

const LANG_COUNTRY: Record<string,string> = {
  ar:'sa',he:'il',fa:'ir',fr:'fr',es:'es',de:'de',ru:'ru',zh:'cn',
  hi:'in',it:'it',pt:'pt',tr:'tr',ja:'jp',ko:'kr',nl:'nl',sv:'se',
  pl:'pl',uk:'ua',da:'dk',fi:'fi',nb:'no',cs:'cz',hu:'hu',ro:'ro',
  bg:'bg',hr:'hr',sk:'sk',sl:'si',et:'ee',lv:'lv',lt:'lt',el:'gr',
  vi:'vn',th:'th',id:'id',ms:'my',
};
const LANG_NAME: Record<string,string> = {
  ar:'Arabic',he:'Hebrew',fa:'Persian',fr:'French',es:'Spanish',
  de:'German',ru:'Russian',zh:'Chinese',hi:'Hindi',it:'Italian',
  pt:'Portuguese',tr:'Turkish',ja:'Japanese',ko:'Korean',nl:'Dutch',
  sv:'Swedish',pl:'Polish',uk:'Ukrainian',da:'Danish',fi:'Finnish',
  nb:'Norwegian',cs:'Czech',hu:'Hungarian',ro:'Romanian',bg:'Bulgarian',
  hr:'Croatian',sk:'Slovak',sl:'Slovenian',et:'Estonian',lv:'Latvian',
  lt:'Lithuanian',el:'Greek',vi:'Vietnamese',th:'Thai',id:'Indonesian',
  ms:'Malay',
};

interface ActiveJob { job_id:string; lang:string; page_id:number; page_title:string; started_at:number; }
interface ServerJob {
  job_id:string; status:string; progress:number; total:number;
  current_lang:string; current_field:string; page_title:string;
  results:any[]|null; error:string|null;
}

export function addJob(job: Omit<ActiveJob,'started_at'>) {
  try {
    const ex: ActiveJob[] = JSON.parse(localStorage.getItem('bt_active_jobs')||'[]');
    const up = [...ex.filter(j=>j.job_id!==job.job_id), {...job, started_at:Date.now()}];
    localStorage.setItem('bt_active_jobs', JSON.stringify(up.slice(-20)));
    window.dispatchEvent(new Event('bt_jobs_updated'));
  } catch {}
}

/* ── tiny icons ── */
const IcPause = ({size=8}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>;
const IcPlay  = ({size=8}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
const IcStop  = () => <svg width={8} height={8} viewBox="0 0 24 24" fill="currentColor"><rect x={3} y={3} width={18} height={18} rx={2}/></svg>;
const IcCheck = () => <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;

function IconBtn({ onClick, disabled, title, color, bg, border, children }: {
  onClick:()=>void; disabled:boolean; title:string;
  color:string; bg:string; border:string; children:React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{width:22,height:22,display:'inline-flex',alignItems:'center',justifyContent:'center',
        borderRadius:5,border,background:bg,color,cursor:'pointer',flexShrink:0,
        opacity:disabled?0.35:1,transition:'opacity .12s,transform .1s'}}
      onMouseEnter={e=>{if(!disabled)(e.currentTarget as HTMLButtonElement).style.opacity='0.7';}}
      onMouseLeave={e=>{if(!disabled)(e.currentTarget as HTMLButtonElement).style.opacity='1';}}
      onMouseDown={e=>{if(!disabled)(e.currentTarget as HTMLButtonElement).style.transform='scale(.9)';}}
      onMouseUp={e=>{(e.currentTarget as HTMLButtonElement).style.transform='scale(1)';}}>
      {children}
    </button>
  );
}

export default function JobsMonitor() {
  const [localJobs, setLocalJobs] = useState<ActiveJob[]>([]);
  const [serverJobs,setServerJobs]= useState<Record<string,ServerJob>>({});
  const [open,      setOpen]      = useState(true);
  const [acting,    setActing]    = useState<Set<string>>(new Set());
  const [errorPopup,setErrorPopup]= useState<{ title: string; msg: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const shownErrors = useRef<Set<string>>(new Set());

  function loadLocal() {
    try { setLocalJobs(JSON.parse(localStorage.getItem('bt_active_jobs')||'[]')); } catch {}
  }
  useEffect(() => {
    loadLocal();
    window.addEventListener('bt_jobs_updated', loadLocal);
    return () => window.removeEventListener('bt_jobs_updated', loadLocal);
  }, []);

  /* ── SINGLE batch poll ── */
  useEffect(() => {
    const active = localJobs.filter(j => {
      const s = serverJobs[j.job_id]?.status;
      return !s || s === 'running' || s === 'paused';
    });
    if (!active.length) return;

    timerRef.current = setTimeout(async () => {
      try {
        const all: ServerJob[] = await fetch('/api/translate/jobs').then(r=>r.json());
        if (!Array.isArray(all)) return;   // 401/500 returns {error} — don't crash the poll
        const map: Record<string,ServerJob> = {};
        for (const j of all) map[j.job_id] = j;

        setServerJobs(prev => {
          const next = {...prev};
          for (const localJob of localJobs) {
            if (map[localJob.job_id]) next[localJob.job_id] = map[localJob.job_id];
          }
          return next;
        });

        for (const localJob of active) {
          const srv = map[localJob.job_id];
          if (!srv) {
            // No longer tracked by the server (completed & pruned, or lost on
            // restart). Stop polling it forever — dismiss shortly.
            setTimeout(() => dismissById(localJob.job_id), 3000);
            continue;
          }
          if (srv.status === 'running' || srv.status === 'paused') continue;
          if ((srv.status === 'error' || srv.status === 'interrupted') && !shownErrors.current.has(localJob.job_id)) {
            shownErrors.current.add(localJob.job_id);
            const pageTitle = srv.page_title || ('Page ' + localJob.page_id);
            setErrorPopup({ title: pageTitle, msg: srv.error || (srv.status === 'interrupted'
              ? 'Job was interrupted by a server restart — please re-run it.' : 'Job failed.') });
          } else if (srv.status !== 'error' && srv.status !== 'interrupted') {
            setTimeout(() => dismissById(localJob.job_id), 5000);
          }
        }
      } catch {}
    }, 2000);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [localJobs, serverJobs]);

  function dismissById(id: string) {
    try {
      const ex: ActiveJob[] = JSON.parse(localStorage.getItem('bt_active_jobs')||'[]');
      localStorage.setItem('bt_active_jobs', JSON.stringify(ex.filter(j=>j.job_id!==id)));
    } catch {}
    setLocalJobs(prev=>prev.filter(j=>j.job_id!==id));
    setServerJobs(prev=>{ const n={...prev}; delete n[id]; return n; });
  }

  async function doAction(fn: ()=>Promise<void>, id?: string) {
    if (id && acting.has(id)) return;
    if (id) setActing(s=>new Set(s).add(id));
    try { await fn(); } catch {}
    try {
      const all: ServerJob[] = await fetch('/api/translate/jobs').then(r=>r.json());
      const map: Record<string,ServerJob> = {};
      for (const j of all) map[j.job_id] = j;
      setServerJobs(prev=>{ const n={...prev,...map}; return n; });
    } catch {}
    if (id) setActing(s=>{ const n=new Set(s); n.delete(id); return n; });
  }

  const pauseJob   = (id:string) => doAction(()=>fetch(`/api/translate/pause/${id}`,{method:'POST'}).then(()=>{}), id);
  const resumeJob  = (id:string) => doAction(()=>fetch(`/api/translate/resume/${id}`,{method:'POST'}).then(()=>{}), id);
  const stopJob    = (id:string) => doAction(()=>fetch(`/api/translate/stop/${id}`,{method:'POST',headers:{'Authorization':'Bearer '+(localStorage.getItem('bt_token')||'')}}).then(()=>{}), id);
  const pauseAll   = ()          => doAction(()=>fetch('/api/translate/pause-all',{method:'POST'}).then(()=>{}));
  const resumeAll  = ()          => doAction(()=>fetch('/api/translate/resume-all',{method:'POST'}).then(()=>{}));

  if (!localJobs.length) return null;

  const jobs = localJobs.map(j => ({ ...j, srv: serverJobs[j.job_id] || null }));

  const runCount   = jobs.filter(j=>!j.srv||j.srv.status==='running').length;
  const pauseCount = jobs.filter(j=>j.srv?.status==='paused').length;
  const doneCount  = jobs.filter(j=>j.srv?.status==='done').length;
  const total      = jobs.length;

  return (
    <>
      {/* ── Fatal error popup ── */}
      {errorPopup && (
        <div style={{
          position:'fixed',inset:0,zIndex:99999,display:'flex',alignItems:'center',justifyContent:'center',
          background:'rgba(0,0,0,0.45)',backdropFilter:'blur(2px)',
          fontFamily:'-apple-system,"Segoe UI",Arial,sans-serif',
        }} onClick={()=>setErrorPopup(null)}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:'#fff',borderRadius:12,padding:'28px 28px 22px',maxWidth:420,width:'90%',
            boxShadow:'0 8px 32px rgba(0,0,0,0.18)',border:'1px solid #fecaca',
          }}>
            {/* Red icon */}
            <div style={{width:48,height:48,borderRadius:'50%',background:'rgba(239,68,68,0.1)',border:'1.5px solid rgba(239,68,68,0.25)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:14}}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={2} strokeLinecap="round">
                <circle cx={12} cy={12} r={10}/><line x1={12} y1={8} x2={12} y2={12}/><line x1={12} y1={16} x2={12.01} y2={16}/>
              </svg>
            </div>
            <div style={{fontSize:16,fontWeight:700,color:'#111',marginBottom:6}}>Translation Failed</div>
            <div style={{fontSize:12,color:'#64748b',marginBottom:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{errorPopup.title}</div>
            <div style={{fontSize:13,color:'#dc2626',background:'rgba(254,226,226,0.6)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:8,padding:'10px 14px',marginBottom:18,lineHeight:1.5}}>
              {errorPopup.msg}
            </div>
            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={()=>setErrorPopup(null)} style={{
                background:'#dc2626',color:'#fff',border:'none',borderRadius:7,
                padding:'9px 22px',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              }}>OK, Got It</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes jm-in   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes jm-ring  { 0%{transform:scale(1);opacity:.6} 70%{transform:scale(2.5);opacity:0} 100%{opacity:0} }
        @keyframes jm-blink { 0%,100%{opacity:1} 50%{opacity:.25} }
        .jm-wrap  { animation:jm-in .22s cubic-bezier(.2,1,.4,1) both; }
        .jm-slide { overflow:hidden; transition:max-height .26s cubic-bezier(.4,0,.2,1), opacity .2s ease; }
        .jm-slide.open { max-height:360px; opacity:1; }
        .jm-slide.shut { max-height:0;     opacity:0; }
        .jm-row:hover { background:#f8fafc !important; }
        .jm-hbtn { width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;cursor:pointer;flex-shrink:0;transition:opacity .12s,transform .1s; }
        .jm-hbtn:hover { opacity:0.7 !important; }
        .jm-hbtn:active { transform:scale(.9); }
      `}</style>

      <div className="jm-wrap" style={{
        position:'fixed',bottom:20,right:20,width:316,
        background:'#fff',border:'1px solid #e2e8f0',borderRadius:10,
        boxShadow:'0 2px 6px rgba(0,0,0,.05),0 8px 20px rgba(0,0,0,.08)',
        zIndex:9999,overflow:'hidden',
        fontFamily:'-apple-system,"Segoe UI",Arial,sans-serif',
      }}>

        {/* ══ HEADER — fixed single line, no overflow ══ */}
        <div onClick={()=>setOpen(o=>!o)} style={{
          display:'flex',alignItems:'center',gap:5,padding:'8px 10px',
          background:runCount>0?'#f0fdf4':pauseCount>0?'#fffbeb':'#f8fafc',
          borderBottom:'1px solid #e9eef3',cursor:'pointer',userSelect:'none',
          overflow:'hidden',
        }}>

          {/* pulse dot */}
          <span style={{position:'relative',display:'inline-flex',width:8,height:8,flexShrink:0}}>
            {runCount>0 && <span style={{position:'absolute',inset:0,borderRadius:'50%',background:'#22c55e',animation:'jm-ring 1.8s ease-out infinite'}}/>}
            <span style={{position:'relative',width:8,height:8,borderRadius:'50%',
              background:runCount>0?'#22c55e':pauseCount>0?'#f59e0b':'#cbd5e1',
              animation:runCount>0?'jm-blink 2s ease-in-out infinite':'none'}}/>
          </span>

          {/* title — takes remaining space, ellipsis if needed */}
          <span style={{fontWeight:600,fontSize:13,color:'#111',whiteSpace:'nowrap',
            flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis'}}>
            Translation Jobs
          </span>

          {/* compact count badge */}
          <span style={{fontSize:10,fontWeight:700,padding:'2px 5px',borderRadius:99,whiteSpace:'nowrap',flexShrink:0,
            background:runCount>0?'rgba(34,197,94,.12)':pauseCount>0?'rgba(245,158,11,.12)':'rgba(100,116,139,.1)',
            color:runCount>0?'#15803d':pauseCount>0?'#b45309':'#64748b',
            border:`1px solid ${runCount>0?'rgba(34,197,94,.2)':pauseCount>0?'rgba(245,158,11,.2)':'rgba(100,116,139,.15)'}`,
          }}>
            {runCount>0 ? `${runCount} run` : pauseCount>0 ? `${pauseCount} paused` : doneCount>0 ? `${doneCount} done` : total}
          </span>

          {/* icon-only: pause-all */}
          {runCount>0 && (
            <button className="jm-hbtn" onClick={e=>{e.stopPropagation();pauseAll();}} title="Pause all"
              style={{border:'1px solid rgba(245,158,11,.35)',background:'rgba(245,158,11,.07)',color:'#d97706'}}>
              <IcPause size={10}/>
            </button>
          )}

          {/* icon-only: resume-all */}
          {pauseCount>0 && (
            <button className="jm-hbtn" onClick={e=>{e.stopPropagation();resumeAll();}} title="Resume all"
              style={{border:'1px solid rgba(34,197,94,.35)',background:'rgba(34,197,94,.07)',color:'#15803d'}}>
              <IcPlay size={10}/>
            </button>
          )}

          {/* chevron */}
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round"
            style={{transition:'transform .2s',transform:open?'rotate(180deg)':'rotate(0deg)',flexShrink:0}}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {/* ══ SCROLLABLE JOB LIST ══ */}
        <div className={`jm-slide ${open?'open':'shut'}`}>
          <div style={{overflowY:'auto',maxHeight:360}}>
            {jobs.map((job, idx) => {
              const srv     = job.srv;
              const pct     = srv&&srv.total>0 ? Math.round(srv.progress/srv.total*100) : 0;
              const isRun   = !srv||srv.status==='running';
              const isPause = srv?.status==='paused';
              const isDone  = srv?.status==='done';
              const isErr   = srv?.status==='error';
              const isStop  = srv?.status==='stopped';
              const busy    = acting.has(job.job_id);
              const cc      = LANG_COUNTRY[job.lang]||'un';
              const nm      = LANG_NAME[job.lang]||job.lang.toUpperCase();
              const title   = srv?.page_title||job.page_title||'Page '+job.page_id;
              const field   = srv?.current_field||'';
              const barClr  = isDone?'#10b981':isErr?'#ef4444':isPause?'#f59e0b':isStop?'#cbd5e1':'#004D42';

              return (
                <div key={job.job_id} className="jm-row" style={{
                  padding:'9px 11px',
                  borderBottom:idx<jobs.length-1?'1px solid #f1f5f9':'none',
                  background:isPause?'rgba(255,251,235,.5)':isDone?'rgba(240,253,244,.4)':isErr?'rgba(254,242,242,.4)':'#fff',
                  transition:'background .12s',
                }}>

                  {/* row 1: flag · name · chip · % · buttons */}
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <span className={`fi fi-${cc}`} style={{fontSize:13,lineHeight:1,flexShrink:0}}/>
                    <span style={{fontWeight:600,fontSize:12,color:'#111',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nm}</span>

                    {isPause && <span style={{fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:3,background:'#fef3c7',color:'#92400e',border:'1px solid rgba(245,158,11,.3)',whiteSpace:'nowrap'}}>PAUSED</span>}
                    {isDone  && <span style={{fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:3,background:'#d1fae5',color:'#065f46',border:'1px solid rgba(16,185,129,.3)',whiteSpace:'nowrap'}}>DONE</span>}
                    {isErr   && <span style={{fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:3,background:'#fee2e2',color:'#991b1b',border:'1px solid rgba(239,68,68,.3)',whiteSpace:'nowrap'}}>ERROR</span>}
                    {isStop  && <span style={{fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:3,background:'#f1f5f9',color:'#64748b',border:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>STOPPED</span>}

                    {(isRun||isPause) && <span style={{fontSize:11,fontWeight:700,color:isPause?'#d97706':'#004D42',minWidth:28,textAlign:'right',flexShrink:0}}>{pct}%</span>}
                    {isDone && <IcCheck/>}

                    <div style={{display:'flex',gap:3,flexShrink:0}}>
                      {isRun   && <IconBtn onClick={()=>pauseJob(job.job_id)}  disabled={busy} title="Pause"   color="#d97706" bg="rgba(245,158,11,.07)"  border="1px solid rgba(245,158,11,.35)"><IcPause/></IconBtn>}
                      {isPause && <IconBtn onClick={()=>resumeJob(job.job_id)} disabled={busy} title="Resume"  color="#15803d" bg="rgba(34,197,94,.07)"   border="1px solid rgba(34,197,94,.35)"><IcPlay/></IconBtn>}
                      {(isRun||isPause) && <IconBtn onClick={()=>stopJob(job.job_id)} disabled={busy} title="Stop" color="#dc2626" bg="rgba(239,68,68,.06)" border="1px solid rgba(239,68,68,.3)"><IcStop/></IconBtn>}
                      <IconBtn onClick={()=>dismissById(job.job_id)} disabled={false} title="Dismiss" color="#94a3b8" bg="#f8fafc" border="1px solid #e2e8f0">
                        <span style={{fontSize:11,lineHeight:1}}>×</span>
                      </IconBtn>
                    </div>
                  </div>

                  {/* row 2: bar + title + field */}
                  {(isRun||isPause||isStop) && (
                    <div style={{paddingLeft:18,marginTop:4}}>
                      <div style={{fontSize:10,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{title}</div>
                      <div style={{background:'#f1f5f9',borderRadius:99,height:3,overflow:'hidden',marginBottom:3}}>
                        <div style={{height:3,borderRadius:99,width:pct+'%',background:barClr,transition:'width .4s ease'}}/>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span style={{fontSize:9,color:'#b0bac5',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:180}}>
                          {isPause&&<span style={{color:'#d97706',fontWeight:600}}>Paused · </span>}{field||(isRun?'Starting…':isStop?`Stopped at ${pct}%`:'')}</span>
                        <span style={{fontSize:9,color:'#b0bac5',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{srv?`${srv.progress}/${srv.total}`:'—'}</span>
                      </div>
                    </div>
                  )}

                  {isDone && srv?.results && (
                    <div style={{paddingLeft:18,marginTop:3,fontSize:10,color:'#059669'}}>{srv.results.reduce((s,r)=>s+r.translated,0)} fields translated</div>
                  )}
                  {isErr && (
                    <div style={{paddingLeft:18,marginTop:3,fontSize:10,color:'#dc2626',background:'rgba(254,226,226,.5)',padding:'3px 7px',borderRadius:4,border:'1px solid rgba(239,68,68,.15)'}}>{srv?.error||'Unknown error'}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* footer */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 11px',background:'#fafafa',borderTop:'1px solid #f1f5f9'}}>
            <span style={{fontSize:10,color:'#94a3b8'}}>{total} job{total!==1?'s':''}</span>
            <button onClick={()=>localJobs.forEach(j=>dismissById(j.job_id))}
              style={{all:'unset',fontSize:10,color:'#94a3b8',cursor:'pointer',textDecoration:'underline'}}>
              Clear all
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
