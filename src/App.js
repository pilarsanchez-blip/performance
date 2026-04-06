import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as d3 from "d3";
import JSZip from "jszip";

const SHEET_NAMES={inputs:"Inputs",total:"Total por colaborador",competencia:"Por competencia por colaborador",direccion:"Por dirección por colaborador",dirCompetencia:"Por dirección por competencia por colaborador",respuestas:"Respuestas por colaborador"};
const COL={ciclo:"Ciclo",username:"Username evaluado",nombre:"Nombre Evaluado",puntaje:"Puntaje",difTotal:"Dif con Total",dimension:"Dimensión",difDimension:"Dif con Total por dimensión",direccion:"Dirección",difDireccion:"Dif con Total por dirección",peso:"Peso"};

/* ─── Palette: celeste-blue gradient, NO green ─── */
const C={
  primary:"#3B5FE5",primaryLight:"#5B7FFF",primaryBg:"#EBF0FF",primarySoft:"#C7D4FE",
  accent:"#7C3AED",accentBg:"#F5F3FF",
  success:"#2563EB",successBg:"#DBEAFE",danger:"#DC2626",dangerBg:"#FEE2E2",
  warning:"#D97706",warningBg:"#FEF3C7",
  text:"#1E293B",textSec:"#64748B",textLight:"#94A3B8",
  bg:"#F8FAFC",white:"#FFFFFF",border:"#E2E8F0",borderLight:"#F1F5F9",
  headerBg:"#EBF0FF",headerBorder:"#C7D4FE",
  // Blue scale for scores: 10 steps (low→high)
  scale:["#E0EFFE","#BAD8FB","#93C0F7","#6BA5F0","#4A8BE5","#3575D5","#2960BD","#1E4DA3","#153C88","#0D2B6B"],
  // Distinct category colors: 8, no green
  cats:["#3B82F6","#D97706","#8B5CF6","#E89D2D","#EC4899","#0EA5E9","#E45A3B","#B45925"],
  // Green/red ONLY for diff badges
  diffUp:"#059669",diffUpBg:"#D1FAE5",diffDown:"#DC2626",diffDownBg:"#FEE2E2",
};

const font=`'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`;

// Get blue shade based on value proximity to max (0→lightest, max→darkest)
const blueShade=(val,max)=>{const pct=Math.min(Math.max(parseFloat(val)/max,0),1);const idx=Math.min(Math.floor(pct*C.scale.length),C.scale.length-1);return C.scale[idx];};

const fetchSheet=async(id,name)=>{const url=`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;const r=await fetch(url);if(!r.ok)throw new Error(name);return d3.csvParse(await r.text()).map(row=>{const c={};for(const[k,v] of Object.entries(row)){if(k&&k.trim()!=="")c[k.trim()]=v;}return c;});};
const parseInputs=(rows)=>{let scaleMin=0,scaleMax=100,origMin=1,origMax=5;for(const r of rows){const keys=Object.keys(r);const f=(r[keys[0]]||"").trim().toLowerCase();if(f.includes("mínimo")||f.includes("minimo")){origMin=parseFloat(r[keys[1]])||1;scaleMin=parseFloat(r[keys[2]])||parseFloat(r[keys[1]])||0;}if(f.includes("máximo")||f.includes("maximo")){origMax=parseFloat(r[keys[1]])||5;scaleMax=parseFloat(r[keys[2]])||parseFloat(r[keys[1]])||100;}}return{scaleMin,scaleMax,origMin,origMax};};
const norm=(s)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const fmt=(n)=>{const v=parseFloat(n);return isNaN(v)?"0.0":v.toFixed(1);};

/* ─── Scale mapping ─── */
const generateMapping=(origMin,origMax,scaleMax,preset)=>{const map={};for(let i=origMin;i<=origMax;i++){if(preset==="proportional")map[i]=Math.round((i/origMax)*scaleMax);else map[i]=Math.round(((i-origMin)/(origMax-origMin))*scaleMax);}return map;};
const interpolateMapping=(val,mapping)=>{const keys=Object.keys(mapping).map(Number).sort((a,b)=>a-b);if(!keys.length)return val;const n=parseFloat(val);if(isNaN(n))return 0;if(n<=keys[0])return mapping[keys[0]];if(n>=keys[keys.length-1])return mapping[keys[keys.length-1]];for(let i=0;i<keys.length-1;i++){if(n>=keys[i]&&n<=keys[i+1]){const t=(n-keys[i])/(keys[i+1]-keys[i]);return mapping[keys[i]]+t*(mapping[keys[i+1]]-mapping[keys[i]]);}}return mapping[keys[keys.length-1]];};
const remapScale=(pct,config,mapping)=>{const n=parseFloat(pct);if(isNaN(n))return 0;const origVal=(n/100)*(config.origMax-config.origMin)+config.origMin;return interpolateMapping(origVal,mapping);};
const remapResp=(val,config,mapping)=>{const n=parseFloat(val);if(isNaN(n))return 0;return interpolateMapping(n,mapping);};

/* ─── Direction weights ─── */
const detectDirections=(dirData)=>{const dirs={};dirData.forEach(r=>{const d=r[COL.direccion]?.trim();const w=parseFloat(r[COL.peso]);if(d&&!dirs[d])dirs[d]=!isNaN(w)?w:1;});return dirs;};
const weightedAvgByDir=(items,dirWeights)=>{const v=items.filter(it=>(dirWeights[it.dir]||0)>0);if(!v.length)return 0;const tw=v.reduce((s,it)=>s+(dirWeights[it.dir]||0),0);return tw===0?0:v.reduce((s,it)=>s+it.score*(dirWeights[it.dir]||0),0)/tw;};

/* ─── Score labels ─── */
const DEFAULT_LABELS=[{min:0,max:25,label:"No cumple",color:"#DC2626"},{min:26,max:50,label:"En desarrollo",color:"#D97706"},{min:51,max:75,label:"Cumple",color:"#3B82F6"},{min:76,max:100,label:"Supera",color:"#1D4ED8"}];
const getScoreLabel=(score,labels)=>{const n=parseFloat(score);if(isNaN(n))return null;return labels.find(l=>n>=l.min&&n<=l.max)||null;};

const useTooltip=()=>{const[tip,setTip]=useState(null);const show=(e,content)=>{const r=e.currentTarget.getBoundingClientRect();setTip({x:r.left+r.width/2,y:r.top-8,content});};const hide=()=>setTip(null);const Tip=()=>tip?<div style={{position:"fixed",left:tip.x,top:tip.y,transform:"translate(-50%,-100%)",background:C.text,color:"#fff",padding:"8px 14px",borderRadius:10,fontSize:12,fontWeight:500,zIndex:9999,pointerEvents:"none",whiteSpace:"pre-line",maxWidth:280,boxShadow:"0 4px 16px rgba(0,0,0,0.15)",lineHeight:1.4}}>{tip.content}</div>:null;return{show,hide,Tip};};

const RadarChart=({data,maxVal,size=300,onHover,onLeave})=>{
  const cx=size/2,cy=size/2,r=size*0.34,n=data.length;if(n===0)return null;const as=(2*Math.PI)/n;
  const gX=(i,v)=>cx+r*(v/maxVal)*Math.cos(as*i-Math.PI/2);const gY=(i,v)=>cy+r*(v/maxVal)*Math.sin(as*i-Math.PI/2);
  const pts=data.map((d,i)=>`${gX(i,d.value)},${gY(i,d.value)}`).join(" ");
  return(<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    {[1,2,3,4,5].map(l=>{const lv=l/5;return<polygon key={l} points={Array.from({length:n},(_,i)=>`${cx+r*lv*Math.cos(as*i-Math.PI/2)},${cy+r*lv*Math.sin(as*i-Math.PI/2)}`).join(" ")} fill="none" stroke={C.border} strokeWidth="1" opacity="0.6"/>;})}
    {data.map((_,i)=><line key={`l${i}`} x1={cx} y1={cy} x2={gX(i,maxVal)} y2={gY(i,maxVal)} stroke={C.border} strokeWidth="1" opacity="0.4"/>)}
    <polygon points={pts} fill={C.primary} fillOpacity="0.12" stroke={C.primary} strokeWidth="2"/>
    {data.map((d,i)=><circle key={`c${i}`} cx={gX(i,d.value)} cy={gY(i,d.value)} r="5" fill={C.primary} stroke={C.white} strokeWidth="2" style={{cursor:"pointer"}} onMouseEnter={e=>onHover&&onHover(e,d)} onMouseLeave={()=>onLeave&&onLeave()}/>)}
    {data.map((d,i)=>{const lx=cx+(r+30)*Math.cos(as*i-Math.PI/2),ly=cy+(r+30)*Math.sin(as*i-Math.PI/2);return<text key={`t${i}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={C.textSec} fontWeight="500" fontFamily={font}>{d.label.length>18?d.label.substring(0,18)+"…":d.label}</text>;})}
  </svg>);
};

const RingChart=({segments,maxVal,size=90})=>{const n=segments.length,ringW=size/(n*2+2),cx=size/2,cy=size/2;return(<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{segments.map((seg,i)=>{const outerR=cx-(i*ringW)-2,innerR=outerR-ringW+2;const pct=Math.min(seg.value/maxVal,1),angle=pct*2*Math.PI-Math.PI/2,la=pct>0.5?1:0;const x1=cx+outerR*Math.cos(-Math.PI/2),y1=cy+outerR*Math.sin(-Math.PI/2),x2=cx+outerR*Math.cos(angle),y2=cy+outerR*Math.sin(angle),ix2=cx+innerR*Math.cos(angle),iy2=cy+innerR*Math.sin(angle),ix1=cx+innerR*Math.cos(-Math.PI/2),iy1=cy+innerR*Math.sin(-Math.PI/2);const d=pct>=0.999?`M${cx},${cy-outerR} A${outerR},${outerR} 0 1,1 ${cx-0.01},${cy-outerR} L${cx-0.01},${cy-innerR} A${innerR},${innerR} 0 1,0 ${cx},${cy-innerR} Z`:`M${x1},${y1} A${outerR},${outerR} 0 ${la},1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${la},0 ${ix1},${iy1} Z`;return<g key={i}><circle cx={cx} cy={cy} r={outerR} fill="none" stroke={C.borderLight} strokeWidth={ringW-2}/><path d={d} fill={C.cats[i%8]}/></g>;})}</svg>);};

const HBar=({label,value,maxVal,color,peso,dimmed})=>(<div style={{marginBottom:12,opacity:dimmed?0.35:1}}>
  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
    <span style={{color:C.text,display:"flex",alignItems:"center",gap:6,fontWeight:500}}>{label}{peso!=null&&<span style={{fontSize:10,color:peso>0?C.textLight:C.danger,background:peso>0?C.borderLight:C.dangerBg,padding:"2px 8px",borderRadius:12,fontWeight:600}}>{peso>0?`${Math.round(peso*100)}%`:"sin peso"}</span>}</span>
    <span style={{fontWeight:600,color:C.text}}>{value}</span></div>
  <div style={{height:10,background:C.borderLight,borderRadius:5}}><div style={{height:10,borderRadius:5,background:color||blueShade(value,maxVal),width:`${Math.min((parseFloat(value)/maxVal)*100,100)}%`,transition:"width 0.4s ease"}}/></div>
</div>);

const VBar=({label,value,maxVal,color,height=150,onHover,onLeave,dimmed})=>{const pct=Math.min((parseFloat(value)/maxVal)*100,100);return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,flex:1,minWidth:0,cursor:"pointer",opacity:dimmed?0.35:1}} onMouseEnter={onHover} onMouseLeave={onLeave}>
  <span style={{fontSize:13,fontWeight:600,color:C.text}}>{value}</span>
  <div style={{width:32,height,background:C.borderLight,borderRadius:8,position:"relative",overflow:"hidden"}}><div style={{position:"absolute",bottom:0,width:"100%",height:`${pct}%`,background:color||blueShade(value,maxVal),borderRadius:8,transition:"height 0.4s ease"}}/></div>
  <span style={{fontSize:10,color:C.textSec,textAlign:"center",maxWidth:90,lineHeight:"1.3",fontWeight:500,minHeight:28,display:"flex",alignItems:"center",justifyContent:"center"}}>{label}</span>
</div>);};

const DiffBadge=({value})=>{const n=parseFloat(value);if(isNaN(n))return null;const pos=n>=0;return<span style={{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:pos?C.diffUpBg:C.diffDownBg,color:pos?C.diffUp:C.diffDown,letterSpacing:"0.02em"}}>{pos?"↑":"↓"} {fmt(Math.abs(n))}</span>;};

const Card=({children,title,icon,badge,style={}})=>(<div style={{background:C.white,borderRadius:14,padding:0,border:`1.5px solid ${C.border}`,overflow:"hidden",...style}}>
  {title&&<div style={{padding:"16px 20px",borderBottom:`1px solid ${C.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
    <h3 style={{fontSize:15,fontWeight:700,color:C.text,margin:0,display:"flex",alignItems:"center",gap:8}}>{icon&&<span>{icon}</span>}{title}</h3>
    {badge&&<span style={{fontSize:12,color:C.primary,fontWeight:600,background:C.primaryBg,padding:"3px 10px",borderRadius:20}}>{badge}</span>}
  </div>}
  <div style={{padding:20}}>{children}</div>
</div>);

const UserSearch=({users,selectedUser,onSelect})=>{const[query,setQuery]=useState("");const[open,setOpen]=useState(false);const ref=useRef(null);const filtered=query?users.filter(u=>norm(u.name).includes(norm(query))):users;const selectedName=users.find(u=>u.username===selectedUser)?.name||"";useEffect(()=>{const h=(e)=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);return(<div ref={ref} style={{position:"relative",minWidth:260}}>
  <input value={open?query:selectedName} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onFocus={()=>{setOpen(true);setQuery("");}} placeholder="Buscar empleado..." style={{width:"100%",padding:"8px 14px 8px 36px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:13,boxSizing:"border-box",outline:"none",fontFamily:font,background:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'/%3E%3C/svg%3E") no-repeat 10px center/16px`}}/>
  {open&&<div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:C.white,borderRadius:12,boxShadow:"0 8px 30px rgba(0,0,0,0.12)",maxHeight:280,overflowY:"auto",zIndex:1000,border:`1px solid ${C.border}`}}>
    {filtered.length===0?<div style={{padding:"12px 16px",color:C.textLight,fontSize:13}}>Sin resultados</div>:filtered.map(u=><div key={u.username} onClick={()=>{onSelect(u.username);setOpen(false);setQuery("");}} style={{padding:"10px 16px",cursor:"pointer",fontSize:13,fontFamily:font,background:u.username===selectedUser?C.primaryBg:"transparent",color:u.username===selectedUser?C.primary:C.text,fontWeight:u.username===selectedUser?600:400,borderBottom:`1px solid ${C.borderLight}`}} onMouseEnter={e=>{if(u.username!==selectedUser)e.target.style.background=C.borderLight;}} onMouseLeave={e=>{e.target.style.background=u.username===selectedUser?C.primaryBg:"transparent";}}>{u.name}</div>)}
  </div>}
</div>);};

/* ─── Settings Modal with 3 tabs ─── */
const SettingsModal=({config,mapping,onChangeMapping,dirWeights,onChangeDirWeights,scoreLabels,onChangeScoreLabels,onClose})=>{
  const[localMapping,setLocalMapping]=useState({...mapping});
  const[localWeights,setLocalWeights]=useState({...dirWeights});
  const[localLabels,setLocalLabels]=useState(scoreLabels.map(l=>({...l})));
  const[activePreset,setActivePreset]=useState(null);
  const[tab,setTab]=useState("weights");
  const keys=Object.keys(localMapping).map(Number).sort((a,b)=>a-b);
  const dirNames=Object.keys(localWeights).sort();
  const applyPreset=(p)=>{setLocalMapping(generateMapping(config.origMin,config.origMax,config.scaleMax,p));setActivePreset(p);};
  useEffect(()=>{for(const p of["proportional","normalized"]){const ref=generateMapping(config.origMin,config.origMax,config.scaleMax,p);if(keys.every(k=>Math.abs((localMapping[k]||0)-(ref[k]||0))<0.5)){setActivePreset(p);return;}}setActivePreset("custom");},[localMapping,config,keys]);
  const totalW=dirNames.reduce((s,d)=>s+(localWeights[d]||0),0);
  const maxOut=config.scaleMax;
  const handleSave=()=>{onChangeMapping(localMapping);onChangeDirWeights(localWeights);onChangeScoreLabels(localLabels);onClose();};
  const addLabel=()=>{const last=localLabels.length?localLabels[localLabels.length-1].max+1:0;setLocalLabels([...localLabels,{min:last,max:Math.min(last+24,100),label:"Nueva etiqueta",color:C.cats[localLabels.length%8]}]);};
  const removeLabel=(i)=>setLocalLabels(localLabels.filter((_,j)=>j!==i));
  const updateLabel=(i,field,val)=>setLocalLabels(localLabels.map((l,j)=>j===i?{...l,[field]:val}:l));

  const tabStyle=(t)=>({flex:1,padding:"8px 0",textAlign:"center",fontSize:12,fontWeight:600,cursor:"pointer",color:tab===t?C.primary:C.textLight,background:"none",border:"none",borderBottom:`2px solid ${tab===t?C.primary:"transparent"}`,fontFamily:font});

  return(
    <div style={{position:"fixed",inset:0,zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.3)"}}/>
      <div style={{position:"relative",background:C.white,borderRadius:16,border:`1.5px solid ${C.border}`,maxWidth:520,width:"92%",boxShadow:"0 20px 60px rgba(0,0,0,0.15)",zIndex:2001,maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"20px 24px 0",flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h2 style={{fontSize:16,fontWeight:700,color:C.text,margin:0}}>Opciones Avanzadas</h2>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:C.textLight,cursor:"pointer",padding:"4px 8px"}}>✕</button>
          </div>
          <div style={{display:"flex",borderBottom:`1px solid ${C.borderLight}`}}>
            <button onClick={()=>setTab("weights")} style={tabStyle("weights")}>Pesos</button>
            <button onClick={()=>setTab("labels")} style={tabStyle("labels")}>Etiquetas</button>
            <button onClick={()=>setTab("scale")} style={tabStyle("scale")}>Escala</button>
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
          {/* ─── Weights tab ─── */}
          {tab==="weights"&&<>
            <p style={{fontSize:12,color:C.textSec,margin:"0 0 16px",lineHeight:1.5}}>Direcciones en <strong>0%</strong> se muestran pero no afectan promedios.</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {dirNames.map((d,i)=>{const w=localWeights[d]||0;const isZ=w===0;return(
                <div key={d} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:isZ?C.dangerBg:C.borderLight,borderRadius:10,border:`1px solid ${isZ?"#FECACA":"transparent"}`}}>
                  <div style={{width:10,height:10,borderRadius:5,flexShrink:0,background:C.cats[i%8],opacity:isZ?0.3:1}}/>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:isZ?C.danger:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d}</div></div>
                  <input type="range" min="0" max="100" step="5" value={Math.round(w*100)} onChange={e=>setLocalWeights(p=>({...p,[d]:parseInt(e.target.value)/100}))} style={{width:80,accentColor:isZ?C.danger:C.primary,cursor:"pointer"}}/>
                  <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
                    <input type="number" min="0" max="100" step="5" value={Math.round(w*100)} onChange={e=>setLocalWeights(p=>({...p,[d]:Math.max(0,Math.min(100,parseInt(e.target.value)||0))/100}))} style={{width:42,padding:"3px 4px",borderRadius:6,border:`1px solid ${isZ?"#FECACA":C.border}`,fontSize:12,fontWeight:600,textAlign:"center",fontFamily:font,color:isZ?C.danger:C.primary,outline:"none",background:C.white}}/>
                    <span style={{fontSize:10,color:C.textLight}}>%</span>
                  </div>
                </div>);
              })}
            </div>
            <div style={{marginTop:12,padding:"10px 14px",borderRadius:10,background:Math.abs(totalW-1)<0.01?"#DBEAFE":C.warningBg,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:600,color:Math.abs(totalW-1)<0.01?"#1D4ED8":C.warning}}>Peso total: {Math.round(totalW*100)}%</span>
              <span style={{fontSize:10,color:C.textSec}}>{Math.abs(totalW-1)<0.01?"Suma correcta":"Se normaliza automáticamente"}</span>
            </div>
          </>}

          {/* ─── Labels tab ─── */}
          {tab==="labels"&&<>
            <p style={{fontSize:12,color:C.textSec,margin:"0 0 16px",lineHeight:1.5}}>Definí rangos y etiquetas que aparecerán en el reporte individual junto al puntaje ponderado.</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {localLabels.map((l,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"10px 12px",background:C.borderLight,borderRadius:10}}>
                  <input type="color" value={l.color} onChange={e=>updateLabel(i,"color",e.target.value)} style={{width:28,height:28,border:"none",borderRadius:6,cursor:"pointer",padding:0}}/>
                  <input value={l.label} onChange={e=>updateLabel(i,"label",e.target.value)} placeholder="Etiqueta..." style={{flex:1,padding:"4px 8px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,fontFamily:font,outline:"none",minWidth:0}}/>
                  <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                    <input type="number" min="0" max="100" value={l.min} onChange={e=>updateLabel(i,"min",parseInt(e.target.value)||0)} style={{width:38,padding:"3px 4px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,textAlign:"center",fontFamily:font,outline:"none"}}/>
                    <span style={{fontSize:10,color:C.textLight}}>–</span>
                    <input type="number" min="0" max="100" value={l.max} onChange={e=>updateLabel(i,"max",parseInt(e.target.value)||0)} style={{width:38,padding:"3px 4px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,textAlign:"center",fontFamily:font,outline:"none"}}/>
                  </div>
                  <button onClick={()=>removeLabel(i)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14,padding:"2px 6px"}}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={addLabel} style={{marginTop:10,width:"100%",padding:"8px",borderRadius:8,border:`1.5px dashed ${C.border}`,background:"transparent",color:C.textSec,fontSize:12,cursor:"pointer",fontFamily:font,fontWeight:500}}>+ Agregar etiqueta</button>
            {localLabels.length>0&&<div style={{marginTop:14,padding:12,background:C.borderLight,borderRadius:10}}>
              <div style={{fontSize:10,fontWeight:600,color:C.textSec,marginBottom:8,textTransform:"uppercase"}}>Vista previa</div>
              <div style={{display:"flex",gap:4,height:8,borderRadius:4,overflow:"hidden",background:C.white}}>
                {localLabels.sort((a,b)=>a.min-b.min).map((l,i)=><div key={i} style={{flex:l.max-l.min,background:l.color,position:"relative"}} title={`${l.label}: ${l.min}–${l.max}`}/>)}
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:8}}>{localLabels.sort((a,b)=>a.min-b.min).map((l,i)=><span key={i} style={{fontSize:10,color:l.color,fontWeight:600}}>{l.label} ({l.min}–{l.max})</span>)}</div>
            </div>}
          </>}

          {/* ─── Scale tab ─── */}
          {tab==="scale"&&<>
            <div style={{background:C.borderLight,borderRadius:10,padding:12,marginBottom:16,display:"flex",gap:16,justifyContent:"center"}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,color:C.textLight,fontWeight:500,textTransform:"uppercase"}}>Original</div><div style={{fontSize:15,fontWeight:700,color:C.text}}>{config.origMin}–{config.origMax}</div></div>
              <div style={{width:1,background:C.border}}/>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,color:C.textLight,fontWeight:500,textTransform:"uppercase"}}>Destino</div><div style={{fontSize:15,fontWeight:700,color:C.primary}}>{config.scaleMin}–{config.scaleMax}</div></div>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[{id:"proportional",name:"Proporcional",desc:"valor ÷ máx"},{id:"normalized",name:"Normalizada",desc:"mín = 0%"}].map(p=>(
                <button key={p.id} onClick={()=>applyPreset(p.id)} style={{flex:1,padding:"10px 12px",borderRadius:10,cursor:"pointer",fontFamily:font,border:`1.5px solid ${activePreset===p.id?C.primary:C.border}`,background:activePreset===p.id?C.primaryBg:C.white,textAlign:"left"}}>
                  <div style={{fontSize:12,fontWeight:600,color:activePreset===p.id?C.primary:C.text}}>{p.name}</div>
                  <div style={{fontSize:10,color:C.textSec}}>{p.desc}</div>
                </button>
              ))}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {keys.map(k=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:C.borderLight,borderRadius:10}}>
                  <div style={{width:28,height:28,borderRadius:7,background:C.primary,display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:13,fontWeight:700,flexShrink:0}}>{k}</div>
                  <span style={{fontSize:12,color:C.textSec,flexShrink:0}}>→</span>
                  <input type="range" min="0" max={maxOut} step="1" value={localMapping[k]} onChange={e=>setLocalMapping(p=>({...p,[k]:parseInt(e.target.value)}))} style={{flex:1,accentColor:C.primary,cursor:"pointer"}}/>
                  <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
                    <input type="number" min="0" max={maxOut} value={localMapping[k]} onChange={e=>setLocalMapping(p=>({...p,[k]:Math.max(0,Math.min(maxOut,parseInt(e.target.value)||0))}))} style={{width:46,padding:"3px 4px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,fontWeight:600,textAlign:"center",fontFamily:font,color:C.primary,outline:"none"}}/>
                    <span style={{fontSize:10,color:C.textLight}}>%</span>
                  </div>
                </div>
              ))}
            </div>
          </>}
        </div>

        <div style={{padding:"16px 24px",borderTop:`1px solid ${C.borderLight}`,flexShrink:0}}>
          <button onClick={handleSave} style={{width:"100%",padding:"11px",borderRadius:10,border:"none",background:C.primary,color:C.white,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:font}}>Aplicar cambios</button>
        </div>
      </div>
    </div>
  );
};

const buildUserData=(data,userId)=>{const matchUser=(r)=>{const u=r[COL.username]||r[COL.nombre];return u===userId;};const tRow=data.total.find(matchUser);if(!tRow)return null;const competencias=data.comp.filter(r=>matchUser(r)&&r[COL.dimension]?.trim()).map(r=>({name:r[COL.dimension],score:parseFloat(r[COL.puntaje])||0,dif:parseFloat(r[COL.difDimension])||0}));const seenDir=new Set();const direcciones=data.dir.filter(matchUser).filter(r=>{const d=r[COL.direccion];if(!d?.trim()||seenDir.has(d))return false;seenDir.add(d);return true;}).map(r=>({name:r[COL.direccion],score:parseFloat(r[COL.puntaje])||0,dif:parseFloat(r[COL.difDireccion])||0,peso:parseFloat(r[COL.peso])||0}));const compDetail={};data.dirComp.filter(matchUser).forEach(r=>{const dim=r[COL.dimension],dir=r[COL.direccion],p=parseFloat(r[COL.puntaje])||0;if(dim?.trim()&&dir?.trim()){if(!compDetail[dim])compDetail[dim]={};compDetail[dim][dir]=p;}});const questions={};data.resp.filter(r=>{const u=r[COL.username]||r["Username evaluado"]||r[COL.nombre]||r["Nombre evaluado"];return u===userId;}).forEach(r=>{const q=r["Pregunta acortada"],dir=r["Dirección"]||r[COL.direccion],dim=r["Dimensión"]||r[COL.dimension],p=parseFloat(r["Puntaje"]||r[COL.puntaje])||0,fullQ=r["Pregunta completa"]||q;if(q?.trim()&&dir?.trim()){const key=q.trim();if(!questions[key])questions[key]={fullQ,dim:dim||"",dirs:{}};questions[key].dirs[dir]=p;}});return{name:tRow[COL.nombre]||"Sin nombre",ciclo:tRow[COL.ciclo]||"",totalScore:parseFloat(tRow[COL.puntaje])||0,totalDif:parseFloat(tRow[COL.difTotal])||0,competencias,direcciones,compDetail,questions};};

const computeWeightedTotal=(ud,scaleVal,dirWeights)=>{if(!ud||!ud.direcciones.length)return 0;const items=ud.direcciones.map(d=>({dir:d.name,score:scaleVal(d.score)}));return weightedAvgByDir(items,dirWeights);};

const generateHTML=(ud,config,mapping,dirWeights,weightedScore,scoreLabels)=>{
  const sv=(val)=>fmt(remapScale(val,config,mapping));const sr=(val)=>fmt(remapResp(val,config,mapping));const mx=config.scaleMax;
  const lbl=getScoreLabel(weightedScore,scoreLabels);
  const lblHtml=lbl?`<span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);margin-top:8px">${lbl.label}</span>`:"";
const genRadar=(data,size=340)=>{const cx=size/2,cy=size/2,r=size*0.30,n=data.length;if(n===0)return"";const as=(2*Math.PI)/n;const gX=(i,v)=>cx+r*(v/mx)*Math.cos(as*i-Math.PI/2);const gY=(i,v)=>cy+r*(v/mx)*Math.sin(as*i-Math.PI/2);let svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;for(let l=1;l<=5;l++){const lv=l/5;let pts="";for(let i=0;i<n;i++){pts+=`${cx+r*lv*Math.cos(as*i-Math.PI/2)},${cy+r*lv*Math.sin(as*i-Math.PI/2)} `;}svg+=`<polygon points="${pts.trim()}" fill="none" stroke="#E2E8F0" stroke-width="1" opacity="0.6"/>`;}for(let i=0;i<n;i++){svg+=`<line x1="${cx}" y1="${cy}" x2="${gX(i,mx)}" y2="${gY(i,mx)}" stroke="#E2E8F0" stroke-width="1" opacity="0.4"/>`;}let pts="";for(let i=0;i<n;i++){pts+=`${gX(i,data[i].value)},${gY(i,data[i].value)} `;}svg+=`<polygon points="${pts.trim()}" fill="#3B82F6" fill-opacity="0.12" stroke="#3B82F6" stroke-width="2"/>`;for(let i=0;i<n;i++){svg+=`<circle cx="${gX(i,data[i].value)}" cy="${gY(i,data[i].value)}" r="4" fill="#3B82F6" stroke="#fff" stroke-width="2"/>`;const lx=cx+(r+35)*Math.cos(as*i-Math.PI/2),ly=cy+(r+35)*Math.sin(as*i-Math.PI/2);svg+=`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#64748B" font-weight="500">${data[i].label.length>25?data[i].label.substring(0,25)+"…":data[i].label}</text>`;}svg+=`</svg>`;return svg;};
const hbar=(label,value,color,w)=>{const pct=Math.min(parseFloat(value)/mx*100,100);const dim=w===0;return`<div style="margin-bottom:10px;${dim?"opacity:0.35":""}"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span style="font-weight:500;display:flex;align-items:center;gap:6px">${label}${dim?'<span style="font-size:9px;color:#DC2626;background:#FEE2E2;padding:1px 6px;border-radius:10px">sin peso</span>':""}</span><span style="font-weight:600">${value}</span></div><div style="height:10px;background:#F1F5F9;border-radius:5px"><div style="height:10px;border-radius:5px;background:${color};width:${pct}%"></div></div></div>`;};
const vBars=`<div style="display:flex;align-items:flex-start;justify-content:center;gap:40px;padding:10px 0">${ud.direcciones.map((d,i)=>{const scaled=sv(d.score);const w=dirWeights[d.name]||0;const pct=Math.min(parseFloat(scaled)/mx*100,100);return`<div style="text-align:center;width:100px;${w===0?"opacity:0.35":""}"><div style="font-weight:600;font-size:13px;margin-bottom:6px">${scaled}</div><div style="width:44px;height:160px;background:#F1F5F9;border-radius:8px;position:relative;margin:0 auto;overflow:hidden"><div style="position:absolute;bottom:0;width:100%;height:${pct}%;background:#3575D5;border-radius:8px"></div></div><div style="font-size:10px;color:#64748B;margin-top:8px;line-height:1.3;font-weight:500;height:30px;display:flex;align-items:flex-start;justify-content:center">${d.name}</div></div>`;}).join("")}</div>`;
const compCards=ud.competencias.map((comp,i)=>{const detailBars=ud.compDetail[comp.name]?Object.entries(ud.compDetail[comp.name]).map(([dir,val],j)=>hbar(dir,sv(val),"#3575D5",dirWeights[dir]||0)).join(""):"";return`<div style="background:#fff;border-radius:14px;border:1.5px solid #E2E8F0;overflow:hidden"><div style="padding:14px 18px;border-bottom:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center"><h4 style="font-size:14px;font-weight:700;margin:0;max-width:55%">${comp.name}</h4><div style="display:flex;align-items:center;gap:8px"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${comp.dif>=0?"#D1FAE5":"#FEE2E2"};color:${comp.dif>=0?"#059669":"#DC2626"}">${comp.dif>=0?"↑":"↓"} ${Math.abs(comp.dif).toFixed(1)}</span><span style="font-size:22px;font-weight:800;color:#1D4ED8">${sv(comp.score)}</span></div></div><div style="padding:16px 18px">${detailBars}</div></div>`;}).join("");
const cats8=["#3B82F6","#D97706","#8B5CF6","#E89D2D","#EC4899","#0EA5E9","#E45A3B","#B45925"];
const genRings=(segments,size=60)=>{const n=segments.length,ringW=size/(n*2+2),cx=size/2,cy=size/2;let svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;for(let i=0;i<n;i++){const outerR=cx-(i*ringW)-2,innerR=outerR-ringW+2;const pct=Math.min(segments[i].value/mx,1),angle=pct*2*Math.PI-Math.PI/2,la=pct>0.5?1:0;svg+=`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="#F1F5F9" stroke-width="${ringW-2}"/>`;if(pct>0.001){const x1=cx+outerR*Math.cos(-Math.PI/2),y1=cy+outerR*Math.sin(-Math.PI/2),x2=cx+outerR*Math.cos(angle),y2=cy+outerR*Math.sin(angle),ix2=cx+innerR*Math.cos(angle),iy2=cy+innerR*Math.sin(angle),ix1=cx+innerR*Math.cos(-Math.PI/2),iy1=cy+innerR*Math.sin(-Math.PI/2);const d=pct>=0.999?`M${cx},${cy-outerR} A${outerR},${outerR} 0 1,1 ${cx-0.01},${cy-outerR} L${cx-0.01},${cy-innerR} A${innerR},${innerR} 0 1,0 ${cx},${cy-innerR} Z`:`M${x1},${y1} A${outerR},${outerR} 0 ${la},1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${la},0 ${ix1},${iy1} Z`;svg+=`<path d="${d}" fill="${cats8[i%8]}"/>`;}}svg+=`</svg>`;return svg;};
const qCards=Object.entries(ud.questions).map(([qName,qData])=>{const segs=Object.entries(qData.dirs).map(([dir,val])=>({label:dir,value:parseFloat(sr(val))}));const items=segs.map((seg,j)=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${cats8[j%8]}"></span>${seg.label}</span><span style="font-weight:600">${seg.value.toFixed(1)}</span></div>`).join("");const ringHtml=segs.length>1?`<div style="flex-shrink:0">${genRings(segs)}</div>`:"";return`<div style="background:#fff;border-radius:14px;border:1.5px solid #E2E8F0;padding:18px;margin-bottom:12px"><div style="display:flex;gap:16px;align-items:center"><div style="flex:1"><h4 style="margin:0 0 4px;font-size:14px;font-weight:700">${qName}</h4>${qData.dim?`<p style="font-size:11px;color:#64748B;margin:0 0 10px">${qData.dim}</p>`:""}${items}</div>${ringHtml}</div></div>`;}).join("");
const dirHeaders=ud.direcciones.map(d=>`<th style="text-align:center;padding:10px;font-size:11px;color:#64748B;${(dirWeights[d.name]||0)===0?"opacity:0.35":""}">${d.name}</th>`).join("");
const compRows=ud.competencias.map((c,i)=>{const dirCells=ud.direcciones.map(d=>`<td style="text-align:center;padding:10px;${(dirWeights[d.name]||0)===0?"opacity:0.35":""}">${ud.compDetail[c.name]?.[d.name]?sv(ud.compDetail[c.name][d.name]):"-"}</td>`).join("");return`<tr style="background:${i%2===0?"#fff":"#F8FAFC"}"><td style="padding:10px;font-weight:600">${c.name}</td><td style="text-align:center;padding:10px;font-weight:700;color:#1D4ED8">${sv(c.score)}</td><td style="text-align:center;padding:10px"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${c.dif>=0?"#D1FAE5":"#FEE2E2"};color:${c.dif>=0?"#059669":"#DC2626"}">${c.dif>=0?"↑":"↓"} ${Math.abs(c.dif).toFixed(1)}</span></td>${dirCells}</tr>`;}).join("");
const radarSvg=genRadar(ud.competencias.map(c=>({label:c.name,value:parseFloat(sv(c.score))})));
return`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${ud.name}</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;background:#F8FAFC;padding:24px;color:#1E293B}.card{background:#fff;border-radius:14px;border:1.5px solid #E2E8F0;margin-bottom:20px;overflow:hidden}.card-head{padding:14px 18px;border-bottom:1px solid #F1F5F9;font-size:15px;font-weight:700}.card-body{padding:18px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}table{width:100%;border-collapse:collapse;font-size:13px}th{border-bottom:2px solid #E2E8F0;padding:10px;color:#64748B;font-weight:600}td{border-bottom:1px solid #F1F5F9;padding:10px}@media print{body{padding:0}.card{break-inside:avoid}}</style></head><body><div style="max-width:900px;margin:0 auto"><div class="card" style="background:linear-gradient(135deg,#3B5FE5,#5B7FFF);color:#fff;border:none"><div class="card-body" style="padding:24px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap"><div><div style="font-size:13px;opacity:0.8;margin-bottom:4px">Evaluado</div><div style="font-size:22px;font-weight:700">${ud.name}</div>${ud.ciclo?`<div style="font-size:11px;opacity:0.7;margin-top:4px">${ud.ciclo}</div>`:""}</div><div style="text-align:right"><div style="font-size:13px;opacity:0.8;margin-bottom:4px">Puntaje Ponderado</div><div style="font-size:40px;font-weight:800">${fmt(weightedScore)}</div>${lblHtml}</div></div></div></div><div class="grid2" style="margin-bottom:20px"><div class="card"><div class="card-head">Competencias</div><div class="card-body" style="display:flex;justify-content:center">${radarSvg}</div></div><div class="card"><div class="card-head">Valoración General</div><div class="card-body">${vBars}</div></div></div><div class="card"><div class="card-head">Detalle por Competencia</div><div class="card-body"><div class="grid2" style="gap:14px">${compCards}</div></div></div>${qCards.length>0?`<div class="card"><div class="card-head">Preguntas</div><div class="card-body">${qCards}</div></div>`:""}<div class="card"><div class="card-head">Resumen Comparativo</div><div class="card-body" style="overflow-x:auto"><table><thead><tr><th style="text-align:left">Competencia</th><th>Puntaje</th><th>vs Prom.</th>${dirHeaders}</tr></thead><tbody>${compRows}</tbody></table></div></div></div></body></html>`;};

const Overview=({data,config,scaleVal,mx,users,mapping,dirWeights})=>{const tt=useTooltip();
const userScores=useMemo(()=>users.map(u=>{const ud=buildUserData(data,u.username);if(!ud)return{...u,score:0};return{...u,score:computeWeightedTotal(ud,scaleVal,dirWeights)};}),[data,users,scaleVal,dirWeights]);
const avgTotal=useMemo(()=>{const s=userScores.map(u=>u.score).filter(n=>!isNaN(n)&&n>0);return s.length?s.reduce((a,b)=>a+b,0)/s.length:0;},[userScores]);
// BUG FIX: dimAvgs should NOT filter by direction — competencia sheet has overall scores per dimension
const dimAvgs=useMemo(()=>{const d={};data.comp.forEach(r=>{const k=r[COL.dimension],p=parseFloat(r[COL.puntaje]);if(k?.trim()&&!isNaN(p)){if(!d[k])d[k]=[];d[k].push(p);}});return Object.entries(d).map(([name,vals])=>({name,avg:vals.reduce((a,b)=>a+b,0)/vals.length}));},[data]);
const dirAvgs=useMemo(()=>{const d={};data.dir.forEach(r=>{const k=r[COL.direccion],p=parseFloat(r[COL.puntaje]);if(k?.trim()&&!isNaN(p)){if(!d[k])d[k]=[];d[k].push(p);}});return Object.entries(d).map(([name,vals])=>({name,avg:vals.reduce((a,b)=>a+b,0)/vals.length,weight:dirWeights[name]||0}));},[data,dirWeights]);
const cycleAvgs=useMemo(()=>{const c={};data.total.forEach(r=>{const cyc=r[COL.ciclo];if(cyc?.trim()&&!c[cyc])c[cyc]={users:new Set(),dims:{},dirs:{}};if(cyc?.trim()){const u=r[COL.username]||r[COL.nombre];if(u)c[cyc].users.add(u);}});data.comp.forEach(r=>{const cyc=r[COL.ciclo],dim=r[COL.dimension],p=parseFloat(r[COL.puntaje]);if(cyc?.trim()&&dim?.trim()&&!isNaN(p)&&c[cyc]){if(!c[cyc].dims[dim])c[cyc].dims[dim]=[];c[cyc].dims[dim].push(p);}});data.dir.forEach(r=>{const cyc=r[COL.ciclo],dir=r[COL.direccion],p=parseFloat(r[COL.puntaje]);if(cyc?.trim()&&dir?.trim()&&!isNaN(p)&&c[cyc]){if(!c[cyc].dirs[dir])c[cyc].dirs[dir]=[];c[cyc].dirs[dir].push(p);}});return Object.entries(c).map(([name,d])=>{const dirList=Object.entries(d.dirs).map(([n,v])=>({name:n,avg:v.reduce((a,b)=>a+b,0)/v.length,weight:dirWeights[n]||0}));const wDirs=dirList.filter(x=>x.weight>0);const tw=wDirs.reduce((s,x)=>s+x.weight,0);const avg=tw>0?wDirs.reduce((s,x)=>s+scaleVal(x.avg)*x.weight,0)/tw:0;return{name,count:d.users.size,avg,dims:Object.entries(d.dims).map(([n,v])=>({name:n,avg:v.reduce((a,b)=>a+b,0)/v.length})),dirs:dirList};});},[data,dirWeights,scaleVal]);
const[expandedCycle,setExpandedCycle]=useState(null);
const distribution=useMemo(()=>{const buckets=[{label:"0-20",min:0,max:20,names:[],color:C.scale[1]},{label:"21-40",min:21,max:40,names:[],color:C.scale[3]},{label:"41-60",min:41,max:60,names:[],color:C.scale[5]},{label:"61-80",min:61,max:80,names:[],color:C.scale[7]},{label:"81-100",min:81,max:100,names:[],color:C.scale[9]}];userScores.forEach(u=>{const b=buckets.find(b=>u.score>=b.min&&u.score<=b.max);if(b)b.names.push(u.name||"?");});return buckets;},[userScores]);
return(<div style={{maxWidth:960,margin:"0 auto",padding:24}}><tt.Tip/>
  <h2 style={{fontSize:20,fontWeight:700,color:C.text,margin:"0 0 20px",letterSpacing:"-0.02em"}}>Resumen General</h2>
  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
    {[["Evaluados",users.length],["Promedio Ponderado",fmt(avgTotal)],["Escala",`${config.scaleMin} - ${config.scaleMax}`]].map(([label,val],i)=>(
      <Card key={i}><div style={{textAlign:"center",padding:4}}><div style={{fontSize:11,color:C.textLight,marginBottom:4,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div><div style={{fontSize:28,fontWeight:800,color:C.primary}}>{val}</div></div></Card>
    ))}
  </div>
  {cycleAvgs.length>0&&<Card title="Promedios por Ciclo" icon="📅" style={{marginBottom:20}}>
    {cycleAvgs.map((c,i)=>(<div key={i} style={{borderBottom:i<cycleAvgs.length-1?`1px solid ${C.borderLight}`:"none"}}>
      <div onClick={()=>setExpandedCycle(expandedCycle===i?null:i)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",cursor:"pointer"}}>
        <div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{expandedCycle===i?"▾":"▸"} {c.name}</div><div style={{fontSize:11,color:C.textLight,marginLeft:16}}>{c.count} evaluados</div></div>
        <div style={{display:"flex",alignItems:"center",gap:12}}><div style={{width:180,height:6,background:C.borderLight,borderRadius:3}}><div style={{height:6,borderRadius:3,background:"#3575D5",width:`${Math.min((c.avg/mx)*100,100)}%`}}/></div><span style={{fontSize:16,fontWeight:700,color:C.primary,minWidth:45,textAlign:"right"}}>{fmt(c.avg)}</span></div>
      </div>
      {expandedCycle===i&&<div style={{padding:"0 0 16px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div><h4 style={{fontSize:12,fontWeight:600,color:C.textLight,margin:"0 0 10px",textTransform:"uppercase",letterSpacing:"0.04em"}}>Por Competencia</h4>{c.dims.map((d,j)=><HBar key={j} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color={C.cats[j%8]}/>)}</div>
        <div><h4 style={{fontSize:12,fontWeight:600,color:C.textLight,margin:"0 0 10px",textTransform:"uppercase",letterSpacing:"0.04em"}}>Por Dirección</h4>{c.dirs.map((d,j)=><HBar key={j} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color="#3575D5" peso={d.weight} dimmed={d.weight===0}/>)}</div>
      </div>}
    </div>))}
  </Card>}
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
    <Card title="Promedio por Competencia" icon="🎯"><div style={{display:"flex",justifyContent:"center"}}><RadarChart data={dimAvgs.map(d=>({label:d.name,value:scaleVal(d.avg)}))} maxVal={mx} onHover={(e,d)=>tt.show(e,`${d.label}\n${fmt(d.value)}`)} onLeave={tt.hide}/></div></Card>
    <Card title="Distribución de Puntajes" icon="📊"><div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:12,height:180,paddingTop:16}}>
      {distribution.map((b,i)=>(<div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flex:1,cursor:"pointer"}} onMouseEnter={e=>tt.show(e,b.names.length?b.names.join("\n"):"Nadie")} onMouseLeave={tt.hide}>
        <span style={{fontSize:13,fontWeight:600,color:C.text}}>{b.names.length}</span>
        <div style={{width:"100%",maxWidth:44,height:Math.max((b.names.length/Math.max(users.length,1))*140,4),background:b.color,borderRadius:6}}/>
        <span style={{fontSize:10,color:C.textSec,fontWeight:500}}>{b.label}</span></div>))}
    </div></Card>
  </div>
  <Card title="Promedio por Dirección" icon="📋" style={{marginBottom:20}}><div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:16,padding:"16px 0"}}>{dirAvgs.map((d,i)=><VBar key={i} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color="#3575D5" dimmed={d.weight===0} onHover={e=>tt.show(e,`${d.name}\n${fmt(scaleVal(d.avg))}\nPeso: ${d.weight>0?Math.round(d.weight*100)+"%":"sin peso"}`)} onLeave={tt.hide}/>)}</div></Card>
  <Card title="Detalle por Competencia" icon="📈">{dimAvgs.map((d,i)=><HBar key={i} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color={C.cats[i%8]}/>)}</Card>
  <div style={{textAlign:"center",padding:"20px 0",color:C.textLight,fontSize:11}}>Seleccioná un empleado en el buscador para ver su reporte individual</div>
</div>);};

function App(){
const[sheetId,setSheetId]=useState("");const[loading,setLoading]=useState(false);const[error,setError]=useState(null);const[data,setData]=useState(null);const[config,setConfig]=useState(null);const[selectedUser,setSelectedUser]=useState(null);const[connected,setConnected]=useState(false);const[view,setView]=useState("overview");const[exporting,setExporting]=useState(false);
const[mapping,setMapping]=useState({});
const[dirWeights,setDirWeights]=useState({});
const[scoreLabels,setScoreLabels]=useState(DEFAULT_LABELS);
const[showSettings,setShowSettings]=useState(false);
const tt=useTooltip();

const loadData=async()=>{setLoading(true);setError(null);try{const results=await Promise.allSettled([fetchSheet(sheetId,SHEET_NAMES.inputs),fetchSheet(sheetId,SHEET_NAMES.total),fetchSheet(sheetId,SHEET_NAMES.competencia),fetchSheet(sheetId,SHEET_NAMES.direccion),fetchSheet(sheetId,SHEET_NAMES.dirCompetencia),fetchSheet(sheetId,SHEET_NAMES.respuestas)]);const[iR,tR,cR,dR,dcR,rR]=results;if(tR.status==="rejected")throw new Error("Error");
const cfg=iR.status==="fulfilled"?parseInputs(iR.value):{scaleMin:0,scaleMax:100,origMin:1,origMax:5};
setConfig(cfg);setMapping(generateMapping(cfg.origMin,cfg.origMax,cfg.scaleMax,"proportional"));
const dirData=dR.status==="fulfilled"?dR.value:[];setDirWeights(detectDirections(dirData));
setData({total:tR.value,comp:cR.status==="fulfilled"?cR.value:[],dir:dirData,dirComp:dcR.status==="fulfilled"?dcR.value:[],resp:rR.status==="fulfilled"?rR.value:[]});setConnected(true);setView("overview");setSelectedUser(null);}catch(e){console.error(e);setError("No pude conectar. Verificá que el Sheet sea público y las pestañas correctas.");}setLoading(false);};

const scaleVal=useCallback((val)=>{if(!config)return parseFloat(val)||0;return remapScale(val,config,mapping);},[config,mapping]);
const scaleResp=useCallback((val)=>{if(!config)return parseFloat(val)||0;return remapResp(val,config,mapping);},[config,mapping]);
const mx=config?config.scaleMax:100;
const users=useMemo(()=>{if(!data)return[];const seen=new Set();return data.total.filter(r=>{const u=r[COL.username]||r[COL.nombre];if(!u||!u.trim()||seen.has(u))return false;seen.add(u);return true;}).map(r=>({username:r[COL.username]||r[COL.nombre],name:r[COL.nombre]||r[COL.username]})).sort((a,b)=>(a.name||"").localeCompare(b.name||""));},[data]);
const handleSelectUser=(u)=>{setSelectedUser(u);setView("individual");};
const userData=useMemo(()=>data&&selectedUser?buildUserData(data,selectedUser):null,[data,selectedUser]);
const weightedTotal=useMemo(()=>userData?computeWeightedTotal(userData,scaleVal,dirWeights):0,[userData,scaleVal,dirWeights]);
const exportZip=async()=>{setExporting(true);try{const zip=new JSZip();for(const user of users){const ud=buildUserData(data,user.username);if(ud){const ws=computeWeightedTotal(ud,scaleVal,dirWeights);const html=generateHTML(ud,config,mapping,dirWeights,ws,scoreLabels);const safeName=ud.name.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s,]/g,"").replace(/\s+/g,"_").substring(0,50);zip.file(`${safeName}.html`,html);}}const blob=await zip.generateAsync({type:"blob"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="reportes_evaluacion.zip";a.click();URL.revokeObjectURL(url);}catch(e){console.error(e);alert("Error generando el ZIP");}setExporting(false);};

if(!connected){return(<div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
  <div style={{maxWidth:460,width:"100%",background:C.white,borderRadius:16,border:`1.5px solid ${C.border}`,padding:36,textAlign:"center"}}>
    <div style={{width:48,height:48,borderRadius:12,background:C.primaryBg,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16}}><span style={{fontSize:24}}>📊</span></div>
    <h1 style={{fontSize:20,fontWeight:700,color:C.text,margin:"0 0 4px",letterSpacing:"-0.02em"}}>Dashboard de Evaluación</h1>
    <p style={{color:C.textSec,fontSize:13,margin:"0 0 28px"}}>Conectá tu Google Sheet para generar reportes</p>
    <div style={{textAlign:"left",marginBottom:16}}>
      <label style={{fontSize:12,fontWeight:600,color:C.text,display:"block",marginBottom:6}}>ID del Google Sheet</label>
      <input value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder="Pegá acá el ID..." style={{width:"100%",padding:"10px 14px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:13,boxSizing:"border-box",outline:"none",fontFamily:font}}/>
      <p style={{fontSize:10,color:C.textLight,marginTop:4}}>Es la parte de la URL entre /d/ y /edit</p>
    </div>
    <div style={{textAlign:"left",marginBottom:24,background:C.borderLight,borderRadius:10,padding:14}}>
      <p style={{fontSize:12,color:C.textSec,margin:0}}>La escala y pesos se detectan automáticamente. Ajustá pesos, etiquetas y escala desde ⚙️ <strong>Opciones Avanzadas</strong>.</p>
    </div>
    {error&&<p style={{color:C.danger,fontSize:12,marginBottom:16,background:C.dangerBg,padding:12,borderRadius:10}}>{error}</p>}
    <button onClick={loadData} disabled={loading||!sheetId} style={{width:"100%",padding:"11px",borderRadius:10,border:"none",background:C.primary,color:C.white,fontSize:14,fontWeight:600,cursor:loading?"wait":"pointer",opacity:loading?0.7:1,fontFamily:font}}>{loading?"Conectando...":"Conectar y cargar datos"}</button>
  </div>
</div>);}

const header=(<div style={{background:C.headerBg,borderBottom:`1.5px solid ${C.headerBorder}`,padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
  <div style={{display:"flex",alignItems:"center",gap:10}}>
    <h1 style={{color:C.primary,fontSize:16,fontWeight:700,margin:0,cursor:"pointer",letterSpacing:"-0.02em"}} onClick={()=>{setView("overview");setSelectedUser(null);}}>Evaluación de Desempeño</h1>
    {view==="individual"&&<button onClick={()=>{setView("overview");setSelectedUser(null);}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${C.border}`,background:C.white,color:C.textSec,fontSize:11,cursor:"pointer",fontFamily:font,fontWeight:500}}>← Resumen</button>}
  </div>
  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
    <UserSearch users={users} selectedUser={selectedUser} onSelect={handleSelectUser}/>
    <button onClick={exportZip} disabled={exporting} style={{padding:"7px 14px",borderRadius:8,border:`1.5px solid ${C.border}`,background:C.white,color:C.text,fontSize:12,cursor:exporting?"wait":"pointer",fontWeight:600,fontFamily:font,display:"flex",alignItems:"center",gap:4}}>
      {exporting?"⏳ Generando...":"📥 ZIP"}
    </button>
    <button onClick={()=>setShowSettings(true)} style={{padding:"7px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,background:C.white,color:C.textSec,fontSize:12,cursor:"pointer",fontFamily:font}} title="Opciones Avanzadas">⚙️</button>
  </div>
</div>);

const settingsModal=showSettings&&config?<SettingsModal config={config} mapping={mapping} onChangeMapping={setMapping} dirWeights={dirWeights} onChangeDirWeights={setDirWeights} scoreLabels={scoreLabels} onChangeScoreLabels={setScoreLabels} onClose={()=>setShowSettings(false)}/>:null;

if(view==="overview"||!userData){return(<div style={{minHeight:"100vh",background:C.bg,fontFamily:font}}>
  {header}{settingsModal}
  <Overview data={data} config={config} scaleVal={scaleVal} mx={mx} users={users} mapping={mapping} dirWeights={dirWeights}/>
</div>);}

const questionsArr=Object.entries(userData.questions||{});
const wAvgDirs=userData.direcciones.filter(d=>(dirWeights[d.name]||0)>0);
const wTotalW=wAvgDirs.reduce((s,d)=>s+(dirWeights[d.name]||0),0);
const wAvgDir=wTotalW>0?wAvgDirs.reduce((s,d)=>s+scaleVal(d.score)*(dirWeights[d.name]||0),0)/wTotalW:0;
const scoreLbl=getScoreLabel(weightedTotal,scoreLabels);

return(<div style={{minHeight:"100vh",background:C.bg,fontFamily:font}}>
  {header}<tt.Tip/>{settingsModal}
  <div style={{maxWidth:960,margin:"0 auto",padding:24}}>
    {/* Hero */}
    <div style={{background:"linear-gradient(135deg,#3B5FE5,#5B7FFF)",borderRadius:14,padding:24,marginBottom:20,color:C.white}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:16}}>
        <div><div style={{fontSize:12,opacity:0.8,marginBottom:4,fontWeight:500}}>Evaluado</div><div style={{fontSize:22,fontWeight:700,letterSpacing:"-0.02em"}}>{userData.name}</div>{userData.ciclo&&<div style={{fontSize:11,opacity:0.7,marginTop:4}}>{userData.ciclo}</div>}</div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:12,opacity:0.8,marginBottom:4,fontWeight:500}}>Puntaje Ponderado</div>
          <span style={{fontSize:40,fontWeight:800}}>{fmt(weightedTotal)}</span>
          {scoreLbl&&<div style={{marginTop:6}}><span style={{padding:"4px 14px",borderRadius:20,fontSize:13,fontWeight:600,background:"rgba(255,255,255,0.2)",color:C.white,border:"1px solid rgba(255,255,255,0.3)"}}>{scoreLbl.label}</span></div>}
        </div>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      <Card title="Competencias" icon="🎯"><div style={{display:"flex",justifyContent:"center"}}><RadarChart data={userData.competencias.map(c=>({label:c.name,value:scaleVal(c.score)}))} maxVal={mx} onHover={(e,d)=>tt.show(e,`${d.label}\n${fmt(d.value)}`)} onLeave={tt.hide}/></div></Card>
      <Card title="Valoración General" icon="📋" badge={`Prom. pond: ${fmt(wAvgDir)}`}>
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:16,padding:"16px 0"}}>{userData.direcciones.map((d,i)=>{const w=dirWeights[d.name]||0;return<VBar key={i} label={d.name} value={fmt(scaleVal(d.score))} maxVal={mx} color="#3575D5" dimmed={w===0} onHover={e=>tt.show(e,`${d.name}\n${fmt(scaleVal(d.score))}\nPeso: ${w>0?Math.round(w*100)+"%":"sin peso"}`)} onLeave={tt.hide}/>;})}</div>
      </Card>
    </div>

    <h3 style={{fontSize:16,fontWeight:700,color:C.text,margin:"0 0 14px",letterSpacing:"-0.02em"}}>Detalle por Competencia</h3>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:22}}>
      {userData.competencias.map((comp,i)=>(<Card key={i}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h4 style={{fontSize:13,fontWeight:700,color:C.text,margin:0,maxWidth:"55%"}}>{comp.name}</h4>
          <div style={{display:"flex",alignItems:"center",gap:8}}><DiffBadge value={comp.dif}/><span style={{fontSize:22,fontWeight:800,color:C.primary}}>{fmt(scaleVal(comp.score))}</span></div>
        </div>
        {userData.compDetail[comp.name]&&Object.entries(userData.compDetail[comp.name]).map(([dir,val],j)=>{const w=dirWeights[dir]||0;return<HBar key={j} label={dir} value={fmt(scaleVal(val))} maxVal={mx} color="#3575D5" peso={w} dimmed={w===0}/>;})}
      </Card>))}
    </div>

    {questionsArr.length>0&&(<><h3 style={{fontSize:16,fontWeight:700,color:C.text,margin:"0 0 14px",letterSpacing:"-0.02em"}}>Preguntas</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12,marginBottom:22}}>
        {questionsArr.map(([qName,qData],i)=>{const segments=Object.entries(qData.dirs).map(([dir,val])=>({label:dir,value:val,scaled:scaleResp(val)}));
          return(<Card key={i}><div style={{display:"flex",gap:20,alignItems:"center"}}>
            <div style={{flex:1}}><h4 style={{fontSize:13,fontWeight:700,color:C.text,margin:"0 0 4px"}}>{qName}</h4>{qData.dim&&<p style={{fontSize:11,color:C.textLight,margin:"0 0 10px"}}>{qData.dim}</p>}
              {segments.map((seg,j)=>(<div key={j} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:13}}><span style={{display:"flex",alignItems:"center",gap:6,fontWeight:500}}><span style={{width:8,height:8,borderRadius:4,background:C.cats[j%8]}}/>{seg.label}</span><span style={{fontWeight:600}}>{fmt(seg.scaled)}</span></div>))}
            </div>{segments.length>1&&<div style={{flexShrink:0}}><RingChart segments={segments.map(s=>({...s,value:s.scaled}))} maxVal={mx} size={60}/></div>}
          </div></Card>);
        })}
      </div></>)}

    <Card title="Resumen Comparativo" icon="📈"><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr style={{borderBottom:`2px solid ${C.border}`}}><th style={{textAlign:"left",padding:"10px 12px",color:C.textSec,fontWeight:600}}>Competencia</th><th style={{textAlign:"center",padding:"10px 12px",color:C.textSec,fontWeight:600}}>Puntaje</th><th style={{textAlign:"center",padding:"10px 12px",color:C.textSec,fontWeight:600}}>vs Prom.</th>{userData.direcciones.map((d,i)=><th key={i} style={{textAlign:"center",padding:"10px 12px",color:C.textSec,fontWeight:600,fontSize:10,opacity:(dirWeights[d.name]||0)===0?0.35:1}}>{d.name}</th>)}</tr></thead>
      <tbody>{userData.competencias.map((comp,i)=>(<tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2===0?C.white:C.bg}}>
        <td style={{padding:"10px 12px",fontWeight:600,color:C.text}}>{comp.name}</td><td style={{textAlign:"center",padding:"10px 12px",fontWeight:700,color:C.primary}}>{fmt(scaleVal(comp.score))}</td><td style={{textAlign:"center",padding:"10px 12px"}}><DiffBadge value={comp.dif}/></td>
        {userData.direcciones.map((d,j)=><td key={j} style={{textAlign:"center",padding:"10px 12px",color:C.text,opacity:(dirWeights[d.name]||0)===0?0.35:1}}>{userData.compDetail[comp.name]?.[d.name]?fmt(scaleVal(userData.compDetail[comp.name][d.name])):"-"}</td>)}
      </tr>))}</tbody>
    </table></div></Card>
  </div>
</div>);
}

export default App;