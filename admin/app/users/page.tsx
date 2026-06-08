'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Shell, { D, Alert } from '../components/Shell';
import { usePermissions, isSuperAdmin } from '../components/PermissionContext';
import { useLanguages, FlagImg } from '../lib/useLanguages';

interface Permission {
  hide_modules:       string[];
  languages:          string[];
  post_types:         string[];
  api:                string;   // 'all' | 'deepseek' | 'openrouter' | 'both'
  models:             string[]; // legacy
  deepseek_models:    string[];
  openrouter_models:  string[];
}
interface User {
  id:string; username:string; role:string;
  created_at:string; last_login:string|null;
  permissions: Permission;
}
interface PostType  { slug:string; label:string; count:number; }
interface ModelItem { id:string; name:string; }

const tk  = () => {
  if (typeof window === 'undefined') return '';
  const ls = localStorage.getItem('bt_token');
  if (ls) return ls;
  // Fallback: read from cookie
  const match = document.cookie.match(/(?:^|;\s*)bt_token=([^;]*)/);
  const cookieToken = match ? decodeURIComponent(match[1]) : '';
  // If found in cookie, save to localStorage for future calls
  if (cookieToken) { try { localStorage.setItem('bt_token', cookieToken); } catch {} }
  return cookieToken;
};
const aH  = () => ({ 'Content-Type':'application/json', Authorization:'Bearer '+tk() });
const dH  = () => ({ Authorization:'Bearer '+tk() }); // DELETE - no Content-Type
const ep  = (): Permission => ({ hide_modules:[], languages:[], post_types:[], api:'all', models:[], deepseek_models:[], openrouter_models:[] });

/* ── tiny helpers ── */
function Avatar({ name, size=36 }:{name:string;size?:number}) {
  return <div style={{ width:size,height:size,borderRadius:'50%',background:'#004D42',border:'2px solid rgba(200,169,81,0.4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.round(size*.4),fontWeight:800,color:'#C8A951',flexShrink:0,letterSpacing:'-0.5px' }}>{name.charAt(0).toUpperCase()}</div>;
}
function RoleBadge({ role }:{role:string}) {
  const sa=role==='superadmin';
  return <span style={{ fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:99,background:sa?'rgba(200,169,81,0.12)':'rgba(59,130,246,0.08)',color:sa?'#854d0e':'#1e40af',border:`1px solid ${sa?'rgba(200,169,81,0.3)':'rgba(59,130,246,0.2)'}`,whiteSpace:'nowrap' }}>{sa?'Super Admin':'User'}</span>;
}
function fmt(s:string|null) { if(!s)return'Never'; try{return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;} }

/* ── Scrollable checkbox list with search ── */
function CheckList({ items, selected, onChange, placeholder }:{
  items:{value:string;label:string;sub?:string}[];
  selected:string[]; onChange:(v:string[])=>void; placeholder:string;
}) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? items.filter(it => it.label.toLowerCase().includes(q.toLowerCase()) || it.value.toLowerCase().includes(q.toLowerCase()))
    : items;

  const toggle=(v:string)=>{
    const n=selected.includes(v)?selected.filter(x=>x!==v):[...selected,v];
    onChange(n);
  };

  return (
    <div style={{ border:'1px solid #d1d9e0',borderRadius:7,background:'#fff',overflow:'hidden' }}>
      {/* Search input */}
      <div style={{ padding:'7px 10px',borderBottom:'1px solid #f1f5f9',background:'#fafbfc' }}>
        <div style={{ position:'relative' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={2} strokeLinecap="round" style={{ position:'absolute',left:8,top:'50%',transform:'translateY(-50%)' }}>
            <circle cx={11} cy={11} r={8}/><line x1={21} y1={21} x2={16.65} y2={16.65}/>
          </svg>
          <input
            value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Search..."
            style={{ width:'100%',padding:'5px 8px 5px 26px',borderRadius:5,border:'1px solid #e2e8f0',fontSize:12,outline:'none',background:'#fff',boxSizing:'border-box' as const,fontFamily:'inherit' }}
          />
          {q && <button onClick={()=>setQ('')} style={{ position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#9ca3af',padding:0,fontSize:14,lineHeight:1 }}>×</button>}
        </div>
      </div>
      {/* List */}
      <div style={{ maxHeight:140,overflowY:'auto' }}>
        {items.length===0
          ? <div style={{ padding:'12px 14px',fontSize:12.5,color:'#94a3b8' }}>{placeholder}</div>
          : filtered.length===0
            ? <div style={{ padding:'10px 14px',fontSize:12,color:'#94a3b8' }}>No results for "{q}"</div>
            : filtered.map(it=>(
              <label key={it.value} style={{ display:'flex',alignItems:'center',gap:9,padding:'7px 12px',cursor:'pointer',borderBottom:'1px solid #f8fafc',transition:'background .1s' }}
                onMouseEnter={e=>(e.currentTarget.style.background='#f8fafc')}
                onMouseLeave={e=>(e.currentTarget.style.background='')}>
                <div onClick={()=>toggle(it.value)} style={{ width:16,height:16,borderRadius:4,border:`2px solid ${selected.includes(it.value)?'#004D42':'#d1d9e0'}`,background:selected.includes(it.value)?'#004D42':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .12s',cursor:'pointer' }}>
                  {selected.includes(it.value) && <svg width={9} height={9} viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"/></svg>}
                </div>
                <input type="checkbox" checked={selected.includes(it.value)} onChange={()=>toggle(it.value)} style={{ display:'none' }} />
                <span style={{ fontSize:13,color:'#111',flex:1 }}>{it.label}</span>
                {it.sub && <span style={{ fontSize:11,color:'#94a3b8' }}>{it.sub}</span>}
              </label>
            ))
        }
      </div>
      {/* Selected count */}
      {selected.length > 0 && (
        <div style={{ padding:'5px 12px',borderTop:'1px solid #f1f5f9',background:'#fafbfc',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <span style={{ fontSize:11,color:'#004D42',fontWeight:600 }}>{selected.length} selected</span>
          <button onClick={()=>onChange([])} style={{ fontSize:11,color:'#94a3b8',background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline' }}>Clear</button>
        </div>
      )}
    </div>
  );
}

/* ── Permission Form ── */
function PermForm({ perm, onChange, langs, postTypes, dsModels, orModels }:{
  perm:Permission; onChange:(p:Permission)=>void;
  langs:{code:string;name:string;flag:string}[];
  postTypes:PostType[]; dsModels:ModelItem[]; orModels:ModelItem[];
}) {
  const sec:React.CSSProperties = { marginBottom:20,paddingBottom:20,borderBottom:'1px solid #f1f5f9' };
  const lbl:React.CSSProperties = { fontSize:11.5,fontWeight:700,color:'#374151',marginBottom:6,display:'block',textTransform:'uppercase',letterSpacing:'0.07em' };
  const allLangs = perm.languages.length===0;
  const allPT    = perm.post_types.length===0;

  return (
    <div>
      {/* Section 1 — Module Restrictions */}
      <div style={sec}>
        <span style={lbl}>Module Restrictions</span>
        <p style={{ margin:'0 0 10px',fontSize:12,color:'#94a3b8',lineHeight:1.5 }}>Select modules to <strong>hide</strong> from this user. Everything else is accessible.</p>
        <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
          {[{key:'settings',label:'Hide Settings',desc:'Cannot open Settings page'},{key:'languages',label:'Hide Languages',desc:'Cannot manage Languages'}].map(it=>(
            <label key={it.key} onClick={()=>{const a=perm.hide_modules.includes(it.key)?perm.hide_modules.filter(x=>x!==it.key):[...perm.hide_modules,it.key]; onChange({...perm,hide_modules:a});}}
              style={{ display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'10px 14px',borderRadius:8,border:`1.5px solid ${perm.hide_modules.includes(it.key)?'#ef4444':'#e9eef3'}`,background:perm.hide_modules.includes(it.key)?'rgba(239,68,68,0.04)':'#fafbfc',transition:'all .12s',userSelect:'none' }}>
              <div style={{ width:18,height:18,borderRadius:5,border:`2px solid ${perm.hide_modules.includes(it.key)?'#ef4444':'#d1d9e0'}`,background:perm.hide_modules.includes(it.key)?'#ef4444':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .12s' }}>
                {perm.hide_modules.includes(it.key) && <svg width={10} height={10} viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round"/></svg>}
              </div>
              <div><div style={{ fontSize:13,fontWeight:600,color:'#111' }}>{it.label}</div><div style={{ fontSize:11,color:'#94a3b8' }}>{it.desc}</div></div>
            </label>
          ))}
        </div>
      </div>

      {/* Section 2 — Language Access */}
      <div style={sec}>
        <span style={lbl}>Language Access</span>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
          <div>
            <label style={{ ...D.label }}>Access Type</label>
            <select value={allLangs?'all':'specific'} onChange={e=>onChange({...perm,languages:e.target.value==='all'?[]:[langs[0]?.code||'ar']})} style={{...D.select,width:'100%'}}>
              <option value="all">All Languages</option>
              <option value="specific">Specific Languages</option>
            </select>
          </div>
          <div>
            <label style={{ ...D.label }}>{allLangs?'Allowed':'Select Languages'}</label>
            {allLangs
              ? <div style={{ padding:'9px 12px',borderRadius:7,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12.5,color:'#15803d',fontWeight:600 }}>All languages allowed</div>
              : <CheckList items={langs.map(l=>({value:l.code,label:l.name}))} selected={perm.languages} onChange={v=>onChange({...perm,languages:v.length?v:[langs[0]?.code||'ar']})} placeholder="No languages configured" />
            }
          </div>
        </div>
      </div>

      {/* Section 3 — Website Modules */}
      <div style={sec}>
        <span style={lbl}>Website Modules</span>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
          <div>
            <label style={{ ...D.label }}>Access Type</label>
            <select value={allPT?'all':'specific'} onChange={e=>onChange({...perm,post_types:e.target.value==='all'?[]:[postTypes[0]?.slug||'page']})} style={{...D.select,width:'100%'}}>
              <option value="all">All Post Types</option>
              <option value="specific">Specific Post Types</option>
            </select>
          </div>
          <div>
            <label style={{ ...D.label }}>{allPT?'Allowed':'Select Post Types'}</label>
            {allPT
              ? <div style={{ padding:'9px 12px',borderRadius:7,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12.5,color:'#15803d',fontWeight:600 }}>All post types allowed</div>
              : <CheckList items={postTypes.map(p=>({value:p.slug,label:p.label,sub:String(p.count)}))} selected={perm.post_types} onChange={v=>onChange({...perm,post_types:v.length?v:[postTypes[0]?.slug||'page']})} placeholder="Loading post types..." />
            }
          </div>
        </div>
      </div>

      {/* Section 4 — AI Model Access */}
      <div>
        <span style={lbl}>AI Model Access</span>
        <div style={{ marginBottom:12 }}>
          <label style={{ ...D.label }}>API Provider</label>
          <select value={perm.api} onChange={e=>onChange({...perm,api:e.target.value,models:[],deepseek_models:[],openrouter_models:[]})} style={{...D.select,maxWidth:240}}>
            <option value="all">All APIs (no restriction)</option>
            <option value="deepseek">DeepSeek only</option>
            <option value="openrouter">OpenRouter only</option>
            <option value="both">Both (DeepSeek + OpenRouter)</option>
          </select>
        </div>
        {perm.api==='all' ? (
          <div style={{ padding:'9px 12px',borderRadius:7,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12.5,color:'#15803d',fontWeight:600 }}>All APIs and models allowed</div>
        ) : perm.api==='both' ? (
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <div>
              <label style={{ ...D.label }}>DeepSeek Models</label>
              <CheckList items={dsModels.map(m=>({value:m.id,label:m.name||m.id}))} selected={perm.deepseek_models} onChange={v=>onChange({...perm,deepseek_models:v})} placeholder="Loading DeepSeek models..." />
              <p style={{ margin:'4px 0 0',fontSize:11,color:'#94a3b8' }}>Empty = all DeepSeek models</p>
            </div>
            <div>
              <label style={{ ...D.label }}>OpenRouter Models</label>
              <CheckList items={orModels.map(m=>({value:m.id,label:m.name||m.id}))} selected={perm.openrouter_models} onChange={v=>onChange({...perm,openrouter_models:v})} placeholder="Loading OpenRouter models..." />
              <p style={{ margin:'4px 0 0',fontSize:11,color:'#94a3b8' }}>Empty = all OpenRouter models</p>
            </div>
          </div>
        ) : perm.api==='deepseek' ? (
          <div>
            <label style={{ ...D.label }}>DeepSeek Models</label>
            <CheckList items={dsModels.map(m=>({value:m.id,label:m.name||m.id}))} selected={perm.deepseek_models} onChange={v=>onChange({...perm,deepseek_models:v})} placeholder="Loading DeepSeek models..." />
            <p style={{ margin:'4px 0 0',fontSize:11,color:'#94a3b8' }}>Empty = all DeepSeek models allowed</p>
          </div>
        ) : (
          <div>
            <label style={{ ...D.label }}>OpenRouter Models</label>
            <CheckList items={orModels.map(m=>({value:m.id,label:m.name||m.id}))} selected={perm.openrouter_models} onChange={v=>onChange({...perm,openrouter_models:v})} placeholder="Loading OpenRouter models..." />
            <p style={{ margin:'4px 0 0',fontSize:11,color:'#94a3b8' }}>Empty = all OpenRouter models allowed</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function UsersPage() {
  const router = useRouter();
  const { user: me } = usePermissions();
  const { languages } = useLanguages();
  const [users,     setUsers]     = useState<User[]>([]);
  const [postTypes, setPostTypes] = useState<PostType[]>([]);
  const [dsModels,  setDsModels]  = useState<ModelItem[]>([]);
  const [orModels,  setOrModels]  = useState<ModelItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [msg,       setMsg]       = useState<{text:string;ok:boolean}|null>(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [editUser,  setEditUser]  = useState<User|null>(null);
  const [delUser,   setDelUser]   = useState<User|null>(null);
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [errors,    setErrors]    = useState<{username?:string;password?:string}>({});
  const [formUser,  setFormUser]  = useState('');
  const [formPass,  setFormPass]  = useState('');
  const [formRole,  setFormRole]  = useState<'user'|'superadmin'>('user');
  const [formPerm,  setFormPerm]  = useState<Permission>(ep());
  const [showPass,  setShowPass]  = useState(false);

  useEffect(() => { if (me && !isSuperAdmin(me)) router.replace('/'); }, [me]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await fetch('/api/users',{headers:aH()}).then(r=>r.json()); setUsers(Array.isArray(d)?d:[]); }
    catch { flash('Failed to load users',false); }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/post-types').then(r=>r.json()).then(d=>{if(Array.isArray(d))setPostTypes(d);}).catch(()=>{});
    fetch('/api/models?api=deepseek').then(r=>r.json()).then(d=>{if(d.models)setDsModels(d.models);}).catch(()=>{});
    fetch('/api/models?api=openrouter').then(r=>r.json()).then(d=>{if(d.models)setOrModels(d.models);}).catch(()=>{});
  }, [load]);

  const flash = (text:string,ok:boolean) => { setMsg({text,ok}); setTimeout(()=>setMsg(null),4000); };

  function openAdd() { setFormUser('');setFormPass('');setFormRole('user');setFormPerm(ep());setShowPass(false);setErrors({});setShowAdd(true); }
  function openEdit(u:User) {
    const p=u.permissions||ep();
    setFormUser(u.username);setFormPass('');setFormRole(u.role as any);setErrors({});
    setFormPerm({hide_modules:p.hide_modules||[],languages:p.languages||[],post_types:p.post_types||[],api:(p as any).api||'all',models:p.models||[],deepseek_models:(p as any).deepseek_models||[],openrouter_models:(p as any).openrouter_models||[]});
    setShowPass(false);setEditUser(u);
  }

  function validate() {
    const e:typeof errors={};
    if (!formUser.trim()) e.username='Username is required';
    if (!editUser && !formPass.trim()) e.password='Password is required';
    setErrors(e);
    return Object.keys(e).length===0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editUser) {
        const body:Record<string,unknown>={permissions:formPerm};
        if (formUser!==editUser.username) body.username=formUser;
        if (formPass.trim()) body.password=formPass;
        const r=await fetch(`/api/users/${editUser.id}`,{method:'PUT',headers:aH(),body:JSON.stringify(body)});
        if(!r.ok) throw new Error((await r.json()).error||'Failed');
        flash('User updated',true); setEditUser(null);
      } else {
        const r=await fetch('/api/users',{method:'POST',headers:aH(),body:JSON.stringify({username:formUser,password:formPass,role:formRole,permissions:formPerm})});
        if(!r.ok) throw new Error((await r.json()).error||'Failed');
        flash('User created',true); setShowAdd(false);
      }
      load();
    } catch(e:any){flash(e.message||'Error saving',false);}
    setSaving(false);
  }

  async function confirmDel() {
    if (!delUser) return;
    setDeleting(true);
    try {
      const r=await fetch(`/api/users/${delUser.id}`,{method:'DELETE',headers:dH()});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      flash('User removed',true); setDelUser(null); load();
    } catch(e:any){flash(e.message||'Error',false);}
    setDeleting(false);
  }

  const langMap:Record<string,string>={};
  languages.forEach(l=>{langMap[l.code]=l.name;});
  const nonAdmins = users.filter(u=>u.role!=='superadmin');

  const overlay:React.CSSProperties={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16};
  const modal:React.CSSProperties={background:'#fff',borderRadius:14,width:'100%',maxWidth:560,maxHeight:'94vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 60px rgba(0,0,0,0.25)',overflow:'hidden'};

  const inp=(hasErr?:string):React.CSSProperties=>({...D.input,borderColor:hasErr?'#ef4444':undefined});

  return (
    <Shell>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24 }}>
        <div><h1 style={D.pageTitle}>Users</h1><p style={D.pageSub}>Manage admin users and their permissions.</p></div>
        <button onClick={openAdd} style={D.btnPrimary}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1={12} y1={5} x2={12} y2={19}/><line x1={5} y1={12} x2={19} y2={12}/></svg>
          Add User
        </button>
      </div>

      <Alert msg={msg} />

      {/* Table */}
      <div style={{ background:'#fff',border:'1px solid #e2e8f0',borderRadius:12,overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
        <table style={{ width:'100%',borderCollapse:'collapse',fontSize:13 }}>
          <thead><tr style={{ background:'#f8fafc',borderBottom:'2px solid #e9eef3' }}>
            {['User','Role','Languages','Website Modules','AI Model','Last Active',''].map((h,i)=>(
              <th key={i} style={{ padding:'12px '+(i===0?'20px':'16px'),textAlign:i===6?'right':'left',fontSize:11,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.07em',whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding:48,textAlign:'center',color:'#94a3b8',fontSize:13 }}>Loading…</td></tr>
            ) : nonAdmins.length===0 ? (
              <tr><td colSpan={7} style={{ padding:48,textAlign:'center' }}>
                <div style={{ color:'#94a3b8',fontSize:13 }}>No users yet.</div>
                <button onClick={openAdd} style={{ ...D.btnPrimary,marginTop:12 }}>Add First User</button>
              </td></tr>
            ) : nonAdmins.map((u,i)=>{
              const p=u.permissions||ep();
              const llbl = !p.languages?.length ? <span style={{color:'#059669',fontSize:12,fontWeight:600}}>All</span> : <span style={{color:'#374151',fontSize:12}}>{p.languages.slice(0,2).map(c=>langMap[c]||c).join(', ')}{p.languages.length>2?` +${p.languages.length-2}`:''}</span>;
              const ptlbl = !p.post_types?.length ? <span style={{color:'#059669',fontSize:12,fontWeight:600}}>All</span> : <span style={{color:'#374151',fontSize:12}}>{p.post_types.slice(0,2).join(', ')}{p.post_types.length>2?` +${p.post_types.length-2}`:''}</span>;
              const pApi=(p as any).api||'all'; const ailbl=pApi==='deepseek'?'DeepSeek':pApi==='openrouter'?'OpenRouter':pApi==='both'?'Both':'All';
              return (
                <tr key={u.id} style={{ borderBottom:i<nonAdmins.length-1?'1px solid #f1f5f9':'none',transition:'background .1s' }}
                  onMouseEnter={e=>(e.currentTarget.style.background='#fafbfc')}
                  onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                  <td style={{ padding:'14px 20px' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:12 }}>
                      <Avatar name={u.username} size={38} />
                      <div><div style={{ fontWeight:700,fontSize:14,color:'#111' }}>{u.username}</div><div style={{ fontSize:11,color:'#94a3b8',marginTop:1 }}>Added {fmt(u.created_at)}</div></div>
                    </div>
                  </td>
                  <td style={{ padding:'14px 16px' }}><RoleBadge role={u.role} /></td>
                  <td style={{ padding:'14px 16px' }}>{llbl}</td>
                  <td style={{ padding:'14px 16px' }}>{ptlbl}</td>
                  <td style={{ padding:'14px 16px',fontSize:12,color:'#374151' }}>{ailbl}</td>
                  <td style={{ padding:'14px 16px',fontSize:12,color:'#94a3b8' }}>{fmt(u.last_login)}</td>
                  <td style={{ padding:'14px 20px',textAlign:'right' }}>
                    <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                      <button onClick={()=>openEdit(u)} style={{...D.btnSecondary,padding:'6px 16px',fontSize:12.5}}>Edit</button>
                      <button onClick={()=>setDelUser(u)} style={{...D.btnDanger,padding:'6px 16px',fontSize:12.5}}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {(showAdd||editUser) && (
        <div style={overlay} onClick={e=>{if(e.target===e.currentTarget&&!saving){setShowAdd(false);setEditUser(null);}}}>
          <div style={modal}>
            {/* Header */}
            <div style={{ padding:'18px 24px 14px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
              <h2 style={{ margin:0,fontSize:16,fontWeight:700,color:'#111' }}>{editUser?`Edit: ${editUser.username}`:'Add New User'}</h2>
              <button onClick={()=>{setShowAdd(false);setEditUser(null);}} style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',padding:4,borderRadius:6,display:'flex' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1={18} y1={6} x2={6} y2={18}/><line x1={6} y1={6} x2={18} y2={18}/></svg>
              </button>
            </div>
            {/* Body */}
            <div style={{ padding:'20px 24px',overflowY:'auto',flex:1 }}>
              {/* Credentials */}
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20,paddingBottom:20,borderBottom:'1px solid #f1f5f9' }}>
                <div>
                  <label style={D.label}>Username <span style={{color:'#ef4444'}}>*</span></label>
                  <input style={inp(errors.username)} placeholder="Enter username" value={formUser} onChange={e=>{setFormUser(e.target.value);setErrors(v=>({...v,username:''}));}} />
                  {errors.username && <p style={{ margin:'4px 0 0',fontSize:11,color:'#ef4444' }}>{errors.username}</p>}
                </div>
                <div>
                  <label style={D.label}>{editUser?'New Password':'Password'} {!editUser&&<span style={{color:'#ef4444'}}>*</span>}</label>
                  <div style={{ position:'relative' }}>
                    <input type={showPass?'text':'password'} style={{...inp(errors.password),paddingRight:40}} placeholder={editUser?'Leave blank to keep':'Enter password'} value={formPass} onChange={e=>{setFormPass(e.target.value);setErrors(v=>({...v,password:''}));}} />
                    <button type="button" onClick={()=>setShowPass(v=>!v)} style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#9ca3af',padding:2,fontSize:15 }}>{showPass?'🙈':'👁'}</button>
                  </div>
                  {errors.password && <p style={{ margin:'4px 0 0',fontSize:11,color:'#ef4444' }}>{errors.password}</p>}
                </div>
                {!editUser && (
                  <div>
                    <label style={D.label}>Role</label>
                    <select style={{...D.select,width:'100%'}} value={formRole} onChange={e=>setFormRole(e.target.value as any)}>
                      <option value="user">User</option>
                      <option value="superadmin">Super Admin</option>
                    </select>
                  </div>
                )}
              </div>
              <PermForm perm={formPerm} onChange={setFormPerm} langs={languages as any[]} postTypes={postTypes} dsModels={dsModels} orModels={orModels} />
            </div>
            {/* Footer */}
            <div style={{ padding:'14px 24px',borderTop:'1px solid #f1f5f9',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0,background:'#fafbfc' }}>
              <button style={D.btnSecondary} onClick={()=>{setShowAdd(false);setEditUser(null);}} disabled={saving}>Cancel</button>
              <button style={{...D.btnPrimary,opacity:saving?0.6:1,minWidth:110}} onClick={save} disabled={saving}>
                {saving?'Saving…':(editUser?'Save Changes':'Create User')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Popup */}
      {delUser && (
        <div style={overlay} onClick={e=>{if(e.target===e.currentTarget&&!deleting)setDelUser(null);}}>
          <div style={{ background:'#fff',borderRadius:14,width:'100%',maxWidth:360,boxShadow:'0 25px 60px rgba(0,0,0,0.25)',overflow:'hidden' }}>
            <div style={{ padding:'28px 28px 0',textAlign:'center' }}>
              <div style={{ width:56,height:56,borderRadius:'50%',background:'#fef2f2',border:'2px solid #fecaca',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px' }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={2} strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </div>
              <h3 style={{ margin:'0 0 8px',fontSize:17,fontWeight:700,color:'#111' }}>Remove User?</h3>
              <p style={{ margin:'0 0 6px',fontSize:14,color:'#6b7280' }}>Are you sure you want to remove <strong style={{color:'#111'}}>{delUser.username}</strong>?</p>
              <p style={{ margin:'0',fontSize:12,color:'#dc2626' }}>This cannot be undone.</p>
            </div>
            <div style={{ padding:'20px 24px 24px',display:'flex',gap:10 }}>
              <button style={{...D.btnSecondary,flex:1,justifyContent:'center'}} onClick={()=>setDelUser(null)} disabled={deleting}>Cancel</button>
              <button onClick={confirmDel} disabled={deleting} style={{ flex:1,padding:'9px 18px',borderRadius:6,border:'none',background:'#dc2626',color:'#fff',fontSize:13,fontWeight:600,cursor:deleting?'not-allowed':'pointer',opacity:deleting?0.6:1,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,fontFamily:'inherit' }}>
                {deleting?'Removing…':'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
