import { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import JSZip from "jszip";

const SHEET_NAMES={inputs:"Inputs",total:"Total por colaborador",competencia:"Por competencia por colaborador",direccion:"Por dirección por colaborador",dirCompetencia:"Por dirección por competencia por colaborador",respuestas:"Respuestas por colaborador"};
const COL={ciclo:"Ciclo",username:"Username evaluado",nombre:"Nombre Evaluado",puntaje:"Puntaje",difTotal:"Dif con Total",dimension:"Dimensión",difDimension:"Dif con Total por dimensión",direccion:"Dirección",difDireccion:"Dif con Total por dirección",peso:"Peso"};

const C={
  primary:"#3B5FE5",primaryLight:"#5B7FFF",primaryBg:"#EBF0FF",primarySoft:"#C7D4FE",
  accent:"#7C3AED",accentBg:"#F5F3FF",
  success:"#059669",successBg:"#D1FAE5",danger:"#DC2626",dangerBg:"#FEE2E2",
  warning:"#D97706",warningBg:"#FEF3C7",
  text:"#1E293B",textSec:"#64748B",textLight:"#94A3B8",
  bg:"#F8FAFC",white:"#FFFFFF",border:"#E2E8F0",borderLight:"#F1F5F9",
  headerBg:"#EBF0FF",headerBorder:"#C7D4FE",
  dirs:["#3B5FE5","#059669","#D97706","#DB2777","#0891B2","#7C3AED"],
};

const font=`'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`;

const fetchSheet=async(id,name)=>{const url=`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;const r=await fetch(url);if(!r.ok)throw new Error(name);return d3.csvParse(await r.text()).map(row=>{const c={};for(const[k,v] of Object.entries(row)){if(k&&k.trim()!=="")c[k.trim()]=v;}return c;});};
const parseInputs=(rows)=>{let scaleMin=0,scaleMax=100,origMin=1,origMax=5;for(const r of rows){const keys=Object.keys(r);const f=(r[keys[0]]||"").trim().toLowerCase();if(f.includes("mínimo")||f.includes("minimo")){origMin=parseFloat(r[keys[1]])||1;scaleMin=parseFloat(r[keys[2]])||parseFloat(r[keys[1]])||0;}if(f.includes("máximo")||f.includes("maximo")){origMax=parseFloat(r[keys[1]])||5;scaleMax=parseFloat(r[keys[2]])||parseFloat(r[keys[1]])||100;}}return{scaleMin,scaleMax,origMin,origMax};};
const norm=(s)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const fmt=(n)=>{const v=parseFloat(n);return isNaN(v)?"0.0":v.toFixed(1);};

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

const RingChart=({segments,maxVal,size=90})=>{const n=segments.length,ringW=size/(n*2+2),cx=size/2,cy=size/2;return(<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{segments.map((seg,i)=>{const outerR=cx-(i*ringW)-2,innerR=outerR-ringW+2;const pct=Math.min(seg.value/maxVal,1),angle=pct*2*Math.PI-Math.PI/2,la=pct>0.5?1:0;const x1=cx+outerR*Math.cos(-Math.PI/2),y1=cy+outerR*Math.sin(-Math.PI/2),x2=cx+outerR*Math.cos(angle),y2=cy+outerR*Math.sin(angle),ix2=cx+innerR*Math.cos(angle),iy2=cy+innerR*Math.sin(angle),ix1=cx+innerR*Math.cos(-Math.PI/2),iy1=cy+innerR*Math.sin(-Math.PI/2);const d=pct>=0.999?`M${cx},${cy-outerR} A${outerR},${outerR} 0 1,1 ${cx-0.01},${cy-outerR} L${cx-0.01},${cy-innerR} A${innerR},${innerR} 0 1,0 ${cx},${cy-innerR} Z`:`M${x1},${y1} A${outerR},${outerR} 0 ${la},1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${la},0 ${ix1},${iy1} Z`;return<g key={i}><circle cx={cx} cy={cy} r={outerR} fill="none" stroke={C.borderLight} strokeWidth={ringW-2}/><path d={d} fill={C.dirs[i%6]}/></g>;})}</svg>);};

const HBar=({label,value,maxVal,color=C.primary,peso})=>(<div style={{marginBottom:12}}>
  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
    <span style={{color:C.text,display:"flex",alignItems:"center",gap:6,fontWeight:500}}>{label}{peso!=null&&peso>0&&<span style={{fontSize:10,color:C.textLight,background:C.borderLight,padding:"2px 8px",borderRadius:12}}>{Math.round(peso*100)}%</span>}</span>
    <span style={{fontWeight:600,color:C.text}}>{value}</span></div>
  <div style={{height:6,background:C.borderLight,borderRadius:3}}><div style={{height:6,borderRadius:3,background:color,width:`${Math.min((parseFloat(value)/maxVal)*100,100)}%`,transition:"width 0.4s ease"}}/></div>
</div>);

const VBar=({label,value,maxVal,color,height=150,onHover,onLeave})=>{const pct=Math.min((parseFloat(value)/maxVal)*100,100);return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,flex:1,cursor:"pointer"}} onMouseEnter={onHover} onMouseLeave={onLeave}>
  <span style={{fontSize:13,fontWeight:600,color:C.text}}>{value}</span>
  <div style={{width:32,height,background:C.borderLight,borderRadius:8,position:"relative",overflow:"hidden"}}><div style={{position:"absolute",bottom:0,width:"100%",height:`${pct}%`,background:color,borderRadius:8,transition:"height 0.4s ease"}}/></div>
  <span style={{fontSize:10,color:C.textSec,textAlign:"center",maxWidth:80,lineHeight:"1.3",fontWeight:500}}>{label}</span>
</div>);};

const DiffBadge=({value})=>{const n=parseFloat(value);if(isNaN(n))return null;const pos=n>=0;return<span style={{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:pos?C.successBg:C.dangerBg,color:pos?C.success:C.danger,letterSpacing:"0.02em"}}>{pos?"↑":"↓"} {fmt(Math.abs(n))}</span>;};

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

const buildUserData=(data,userId)=>{const matchUser=(r)=>{const u=r[COL.username]||r[COL.nombre];return u===userId;};const tRow=data.total.find(matchUser);if(!tRow)return null;const competencias=data.comp.filter(r=>matchUser(r)&&r[COL.dimension]?.trim()).map(r=>({name:r[COL.dimension],score:parseFloat(r[COL.puntaje])||0,dif:parseFloat(r[COL.difDimension])||0}));const seenDir=new Set();const direcciones=data.dir.filter(matchUser).filter(r=>{const d=r[COL.direccion];if(!d?.trim()||seenDir.has(d))return false;seenDir.add(d);return true;}).map(r=>({name:r[COL.direccion],score:parseFloat(r[COL.puntaje])||0,dif:parseFloat(r[COL.difDireccion])||0,peso:parseFloat(r[COL.peso])||0}));const compDetail={};data.dirComp.filter(matchUser).forEach(r=>{const dim=r[COL.dimension],dir=r[COL.direccion],p=parseFloat(r[COL.puntaje])||0;if(dim?.trim()&&dir?.trim()){if(!compDetail[dim])compDetail[dim]={};compDetail[dim][dir]=p;}});const questions={};data.resp.filter(r=>{const u=r[COL.username]||r["Username evaluado"]||r[COL.nombre]||r["Nombre evaluado"];return u===userId;}).forEach(r=>{const q=r["Pregunta acortada"],dir=r["Dirección"]||r[COL.direccion],dim=r["Dimensión"]||r[COL.dimension],p=parseFloat(r["Puntaje"]||r[COL.puntaje])||0,fullQ=r["Pregunta completa"]||q;if(q?.trim()&&dir?.trim()){const key=q.trim();if(!questions[key])questions[key]={fullQ,dim:dim||"",dirs:{}};questions[key].dirs[dir]=p;}});return{name:tRow[COL.nombre]||"Sin nombre",ciclo:tRow[COL.ciclo]||"",totalScore:parseFloat(tRow[COL.puntaje])||0,totalDif:parseFloat(tRow[COL.difTotal])||0,competencias,direcciones,compDetail,questions};};

const generateHTML=(ud,config)=>{const sv=(val)=>{const n=parseFloat(val);if(isNaN(n))return"0.0";return((n/100)*(config.scaleMax-config.scaleMin)+config.scaleMin).toFixed(1);};const sr=(val)=>{const n=parseFloat(val);if(isNaN(n))return"0.0";return(((n-config.origMin)/(config.origMax-config.origMin))*(config.scaleMax-config.scaleMin)+config.scaleMin).toFixed(1);};const mx=config.scaleMax;const dirs=["#3B5FE5","#059669","#D97706","#DB2777","#0891B2","#7C3AED"];
const genRadar=(data,size=280)=>{const cx=size/2,cy=size/2,r=size*0.34,n=data.length;if(n===0)return"";const as=(2*Math.PI)/n;const gX=(i,v)=>cx+r*(v/mx)*Math.cos(as*i-Math.PI/2);const gY=(i,v)=>cy+r*(v/mx)*Math.sin(as*i-Math.PI/2);let svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;for(let l=1;l<=5;l++){const lv=l/5;let pts="";for(let i=0;i<n;i++){pts+=`${cx+r*lv*Math.cos(as*i-Math.PI/2)},${cy+r*lv*Math.sin(as*i-Math.PI/2)} `;}svg+=`<polygon points="${pts.trim()}" fill="none" stroke="#E2E8F0" stroke-width="1" opacity="0.6"/>`;}for(let i=0;i<n;i++){svg+=`<line x1="${cx}" y1="${cy}" x2="${gX(i,mx)}" y2="${gY(i,mx)}" stroke="#E2E8F0" stroke-width="1" opacity="0.4"/>`;}let pts="";for(let i=0;i<n;i++){pts+=`${gX(i,data[i].value)},${gY(i,data[i].value)} `;}svg+=`<polygon points="${pts.trim()}" fill="#3B5FE5" fill-opacity="0.12" stroke="#3B5FE5" stroke-width="2"/>`;for(let i=0;i<n;i++){svg+=`<circle cx="${gX(i,data[i].value)}" cy="${gY(i,data[i].value)}" r="4" fill="#3B5FE5" stroke="#fff" stroke-width="2"/>`;const lx=cx+(r+28)*Math.cos(as*i-Math.PI/2),ly=cy+(r+28)*Math.sin(as*i-Math.PI/2);svg+=`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#64748B" font-weight="500">${data[i].label.length>18?data[i].label.substring(0,18)+"…":data[i].label}</text>`;}svg+=`</svg>`;return svg;};
const genRings=(segments,size=90)=>{const n=segments.length,ringW=size/(n*2+2),cx=size/2,cy=size/2;let svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;for(let i=0;i<n;i++){const outerR=cx-(i*ringW)-2,innerR=outerR-ringW+2;const pct=Math.min(segments[i].value/mx,1),angle=pct*2*Math.PI-Math.PI/2,la=pct>0.5?1:0;svg+=`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="#F1F5F9" stroke-width="${ringW-2}"/>`;if(pct>0.001){const x1=cx+outerR*Math.cos(-Math.PI/2),y1=cy+outerR*Math.sin(-Math.PI/2),x2=cx+outerR*Math.cos(angle),y2=cy+outerR*Math.sin(angle),ix2=cx+innerR*Math.cos(angle),iy2=cy+innerR*Math.sin(angle),ix1=cx+innerR*Math.cos(-Math.PI/2),iy1=cy+innerR*Math.sin(-Math.PI/2);const d=pct>=0.999?`M${cx},${cy-outerR} A${outerR},${outerR} 0 1,1 ${cx-0.01},${cy-outerR} L${cx-0.01},${cy-innerR} A${innerR},${innerR} 0 1,0 ${cx},${cy-innerR} Z`:`M${x1},${y1} A${outerR},${outerR} 0 ${la},1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${la},0 ${ix1},${iy1} Z`;svg+=`<path d="${d}" fill="${dirs[i%6]}"/>`;}}svg+=`</svg>`;return svg;};
const hbar=(label,value,color)=>{const pct=Math.min(parseFloat(value)/mx*100,100);return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span style="font-weight:500">${label}</span><span style="font-weight:600">${value}</span></div><div style="height:6px;background:#F1F5F9;border-radius:3px"><div style="height:6px;border-radius:3px;background:${color};width:${pct}%"></div></div></div>`;};
const vBars=ud.direcciones.map((d,i)=>{const pct=Math.min(parseFloat(sv(d.score))/mx*100,100);return`<div style="text-align:center;flex:1"><div style="font-weight:600;font-size:13px;margin-bottom:6px">${sv(d.score)}</div><div style="height:140px;background:#F1F5F9;border-radius:8px;position:relative;margin:0 6px"><div style="position:absolute;bottom:0;width:100%;height:${pct}%;background:${dirs[i%6]};border-radius:8px"></div></div><div style="font-size:10px;color:#64748B;margin-top:6px;line-height:1.3;font-weight:500">${d.name}</div></div>`;}).join("");
const compCards=ud.competencias.map((comp,i)=>{const detailBars=ud.compDetail[comp.name]?Object.entries(ud.compDetail[comp.name]).map(([dir,val],j)=>hbar(dir,sv(val),dirs[j%6])).join(""):"";return`<div style="background:#fff;border-radius:14px;border:1.5px solid #E2E8F0;overflow:hidden"><div style="padding:14px 18px;border-bottom:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center"><h4 style="font-size:14px;font-weight:700;margin:0;max-width:55%">${comp.name}</h4><div style="display:flex;align-items:center;gap:8px"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${comp.dif>=0?"#D1FAE5":"#FEE2E2"};color:${comp.dif>=0?"#059669":"#DC2626"}">${comp.dif>=0?"↑":"↓"} ${Math.abs(comp.dif).toFixed(1)}</span><span style="font-size:22px;font-weight:800;color:#4338CA">${sv(comp.score)}</span></div></div><div style="padding:16px 18px">${detailBars}</div></div>`;}).join("");
const qCards=Object.entries(ud.questions).map(([qName,qData])=>{const segs=Object.entries(qData.dirs).map(([dir,val])=>({label:dir,value:parseFloat(sr(val))}));const items=segs.map((seg,j)=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${dirs[j%6]}"></span>${seg.label}</span><span style="font-weight:600">${seg.value.toFixed(1)}</span></div>`).join("");return`<div style="background:#fff;border-radius:14px;border:1.5px solid #E2E8F0;padding:18px;margin-bottom:12px"><div style="display:flex;gap:20px;align-items:center"><div style="flex:1"><h4 style="margin:0 0 4px;font-size:14px;font-weight:700">${qName}</h4>${qData.dim?`<p style="font-size:11px;color:#64748B;margin:0 0 10px">${qData.dim}</p>`:""}${items}</div>${segs.length>1?`<div style="flex-shrink:0">${genRings(segs)}</div>`:""}</div></div>`;}).join("");
const dirHeaders=ud.direcciones.map(d=>`<th style="text-align:center;padding:10px;font-size:11px;color:#64748B">${d.name}</th>`).join("");
const compRows=ud.competencias.map((c,i)=>{const dirCells=ud.direcciones.map(d=>`<td style="text-align:center;padding:10px">${ud.compDetail[c.name]?.[d.name]?sv(ud.compDetail[c.name][d.name]):"-"}</td>`).join("");return`<tr style="background:${i%2===0?"#fff":"#F8FAFC"}"><td style="padding:10px;font-weight:600">${c.name}</td><td style="text-align:center;padding:10px;font-weight:700;color:#4338CA">${sv(c.score)}</td><td style="text-align:center;padding:10px"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${c.dif>=0?"#D1FAE5":"#FEE2E2"};color:${c.dif>=0?"#059669":"#DC2626"}">${c.dif>=0?"↑":"↓"} ${Math.abs(c.dif).toFixed(1)}</span></td>${dirCells}</tr>`;}).join("");
const radarSvg=genRadar(ud.competencias.map(c=>({label:c.name,value:parseFloat(sv(c.score))})));
const avgDir=ud.direcciones.length>0?sv(ud.direcciones.reduce((s,d)=>s+d.score,0)/ud.direcciones.length):"0.0";
return`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${ud.name}</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;background:#F8FAFC;padding:24px;color:#1E293B}.card{background:#fff;border-radius:14px;border:1.5px solid #E2E8F0;margin-bottom:20px;overflow:hidden}.card-head{padding:14px 18px;border-bottom:1px solid #F1F5F9;font-size:15px;font-weight:700}.card-body{padding:18px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}table{width:100%;border-collapse:collapse;font-size:13px}th{border-bottom:2px solid #E2E8F0;padding:10px;color:#64748B;font-weight:600}td{border-bottom:1px solid #F1F5F9;padding:10px}@media print{body{padding:0}.card{break-inside:avoid}}</style></head><body><div style="max-width:900px;margin:0 auto"><div class="card" style="background:linear-gradient(135deg,#3B5FE5,#5B7FFF);color:#fff;border:none"><div class="card-body" style="padding:24px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap"><div><div style="font-size:13px;opacity:0.8;margin-bottom:4px">Evaluado</div><div style="font-size:22px;font-weight:700">${ud.name}</div>${ud.ciclo?`<div style="font-size:11px;opacity:0.7;margin-top:4px">${ud.ciclo}</div>`:""}</div><div style="text-align:right"><div style="font-size:13px;opacity:0.8;margin-bottom:4px">Puntaje General</div><div><span style="padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${ud.totalDif>=0?"rgba(5,150,105,0.25)":"rgba(220,38,38,0.25)"};color:#fff">${ud.totalDif>=0?"↑":"↓"} ${Math.abs(ud.totalDif).toFixed(1)} vs prom.</span><span style="font-size:40px;font-weight:800;margin-left:12px">${sv(ud.totalScore)}</span></div></div></div></div></div><div class="grid2" style="margin-bottom:20px"><div class="card"><div class="card-head">Competencias</div><div class="card-body" style="display:flex;justify-content:center">${radarSvg}</div></div><div class="card"><div class="card-head">Valoración General <span style="font-weight:400;color:#64748B;font-size:13px;margin-left:8px">Promedio: ${avgDir}</span></div><div class="card-body"><div style="display:flex;align-items:flex-end;justify-content:center;gap:16px;padding:10px 0">${vBars}</div></div></div></div><div class="card"><div class="card-head">Detalle por Competencia</div><div class="card-body"><div class="grid2" style="gap:14px">${compCards}</div></div></div>${qCards.length>0?`<div class="card"><div class="card-head">Preguntas</div><div class="card-body">${qCards}</div></div>`:""}<div class="card"><div class="card-head">Resumen Comparativo</div><div class="card-body" style="overflow-x:auto"><table><thead><tr><th style="text-align:left">Competencia</th><th>Puntaje</th><th>vs Prom.</th>${dirHeaders}</tr></thead><tbody>${compRows}</tbody></table></div></div><div style="text-align:center;padding:20px 0;color:#94A3B8;font-size:11px">Escala: ${config.scaleMin} - ${config.scaleMax}</div></div></body></html>`;};

const Overview=({data,config,scaleVal,mx,users})=>{const tt=useTooltip();
const avgTotal=useMemo(()=>{const s=data.total.map(r=>parseFloat(r[COL.puntaje])).filter(n=>!isNaN(n));return s.length?s.reduce((a,b)=>a+b,0)/s.length:0;},[data]);
const dimAvgs=useMemo(()=>{const d={};data.comp.forEach(r=>{const k=r[COL.dimension],p=parseFloat(r[COL.puntaje]);if(k?.trim()&&!isNaN(p)){if(!d[k])d[k]=[];d[k].push(p);}});return Object.entries(d).map(([name,vals])=>({name,avg:vals.reduce((a,b)=>a+b,0)/vals.length}));},[data]);
const dirAvgs=useMemo(()=>{const d={};data.dir.forEach(r=>{const k=r[COL.direccion],p=parseFloat(r[COL.puntaje]);if(k?.trim()&&!isNaN(p)){if(!d[k])d[k]=[];d[k].push(p);}});return Object.entries(d).map(([name,vals])=>({name,avg:vals.reduce((a,b)=>a+b,0)/vals.length}));},[data]);
const cycleAvgs=useMemo(()=>{const c={};data.total.forEach(r=>{const cyc=r[COL.ciclo],p=parseFloat(r[COL.puntaje]);if(cyc?.trim()&&!isNaN(p)){if(!c[cyc])c[cyc]={scores:[],dims:{},dirs:{}};c[cyc].scores.push(p);}});data.comp.forEach(r=>{const cyc=r[COL.ciclo],dim=r[COL.dimension],p=parseFloat(r[COL.puntaje]);if(cyc?.trim()&&dim?.trim()&&!isNaN(p)&&c[cyc]){if(!c[cyc].dims[dim])c[cyc].dims[dim]=[];c[cyc].dims[dim].push(p);}});data.dir.forEach(r=>{const cyc=r[COL.ciclo],dir=r[COL.direccion],p=parseFloat(r[COL.puntaje]);if(cyc?.trim()&&dir?.trim()&&!isNaN(p)&&c[cyc]){if(!c[cyc].dirs[dir])c[cyc].dirs[dir]=[];c[cyc].dirs[dir].push(p);}});return Object.entries(c).map(([name,d])=>({name,avg:d.scores.reduce((a,b)=>a+b,0)/d.scores.length,count:d.scores.length,dims:Object.entries(d.dims).map(([n,v])=>({name:n,avg:v.reduce((a,b)=>a+b,0)/v.length})),dirs:Object.entries(d.dirs).map(([n,v])=>({name:n,avg:v.reduce((a,b)=>a+b,0)/v.length}))}));},[data]);
const[expandedCycle,setExpandedCycle]=useState(null);
const distribution=useMemo(()=>{const seen=new Set();const people=data.total.filter(r=>{const u=r[COL.username]||r[COL.nombre];if(!u||!u.trim()||seen.has(u))return false;seen.add(u);return true;});const buckets=[{label:"0-20",min:0,max:20,names:[],color:C.danger},{label:"21-40",min:21,max:40,names:[],color:C.warning},{label:"41-60",min:41,max:60,names:[],color:"#EA580C"},{label:"61-80",min:61,max:80,names:[],color:C.primaryLight},{label:"81-100",min:81,max:100,names:[],color:C.success}];people.forEach(r=>{const s=parseFloat(r[COL.puntaje]);const b=buckets.find(b=>s>=b.min&&s<=b.max);if(b)b.names.push(r[COL.nombre]||"?");});return buckets;},[data]);
return(<div style={{maxWidth:960,margin:"0 auto",padding:24}}><tt.Tip/>
  <h2 style={{fontSize:20,fontWeight:700,color:C.text,margin:"0 0 20px",letterSpacing:"-0.02em"}}>Resumen General</h2>
  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
    {[["Evaluados",users.length],["Promedio General",fmt(scaleVal(avgTotal))],["Escala",`${config.scaleMin} - ${config.scaleMax}`]].map(([label,val],i)=>(
      <Card key={i}><div style={{textAlign:"center",padding:4}}><div style={{fontSize:11,color:C.textLight,marginBottom:4,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div><div style={{fontSize:28,fontWeight:800,color:C.primary}}>{val}</div></div></Card>
    ))}
  </div>
  {cycleAvgs.length>0&&<Card title="Promedios por Ciclo" icon="📅" style={{marginBottom:20}}>
    {cycleAvgs.map((c,i)=>(<div key={i} style={{borderBottom:i<cycleAvgs.length-1?`1px solid ${C.borderLight}`:"none"}}>
      <div onClick={()=>setExpandedCycle(expandedCycle===i?null:i)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",cursor:"pointer"}}>
        <div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{expandedCycle===i?"▾":"▸"} {c.name}</div><div style={{fontSize:11,color:C.textLight,marginLeft:16}}>{c.count} evaluados</div></div>
        <div style={{display:"flex",alignItems:"center",gap:12}}><div style={{width:180,height:6,background:C.borderLight,borderRadius:3}}><div style={{height:6,borderRadius:3,background:C.dirs[i%6],width:`${Math.min((c.avg/100)*100,100)}%`}}/></div><span style={{fontSize:16,fontWeight:700,color:C.primary,minWidth:45,textAlign:"right"}}>{fmt(scaleVal(c.avg))}</span></div>
      </div>
      {expandedCycle===i&&<div style={{padding:"0 0 16px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div><h4 style={{fontSize:12,fontWeight:600,color:C.textLight,margin:"0 0 10px",textTransform:"uppercase",letterSpacing:"0.04em"}}>Por Competencia</h4>{c.dims.map((d,j)=><HBar key={j} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color={C.dirs[j%6]}/>)}</div>
        <div><h4 style={{fontSize:12,fontWeight:600,color:C.textLight,margin:"0 0 10px",textTransform:"uppercase",letterSpacing:"0.04em"}}>Por Dirección</h4>{c.dirs.map((d,j)=><HBar key={j} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color={C.dirs[j%6]}/>)}</div>
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
  <Card title="Promedio por Dirección" icon="📋" style={{marginBottom:20}}><div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:16,padding:"16px 0"}}>{dirAvgs.map((d,i)=><VBar key={i} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color={C.dirs[i%6]} onHover={e=>tt.show(e,`${d.name}\n${fmt(scaleVal(d.avg))}`)} onLeave={tt.hide}/>)}</div></Card>
  <Card title="Detalle por Competencia" icon="📈">{dimAvgs.map((d,i)=><HBar key={i} label={d.name} value={fmt(scaleVal(d.avg))} maxVal={mx} color={C.dirs[i%6]}/>)}</Card>
  <div style={{textAlign:"center",padding:"20px 0",color:C.textLight,fontSize:11}}>Seleccioná un empleado en el buscador para ver su reporte individual</div>
</div>);};

function App(){
const[sheetId,setSheetId]=useState("");const[loading,setLoading]=useState(false);const[error,setError]=useState(null);const[data,setData]=useState(null);const[config,setConfig]=useState(null);const[selectedUser,setSelectedUser]=useState(null);const[connected,setConnected]=useState(false);const[view,setView]=useState("overview");const[exporting,setExporting]=useState(false);const tt=useTooltip();
const loadData=async()=>{setLoading(true);setError(null);try{const results=await Promise.allSettled([fetchSheet(sheetId,SHEET_NAMES.inputs),fetchSheet(sheetId,SHEET_NAMES.total),fetchSheet(sheetId,SHEET_NAMES.competencia),fetchSheet(sheetId,SHEET_NAMES.direccion),fetchSheet(sheetId,SHEET_NAMES.dirCompetencia),fetchSheet(sheetId,SHEET_NAMES.respuestas)]);const[iR,tR,cR,dR,dcR,rR]=results;if(tR.status==="rejected")throw new Error("Error");setConfig(iR.status==="fulfilled"?parseInputs(iR.value):{scaleMin:0,scaleMax:100,origMin:1,origMax:5});setData({total:tR.value,comp:cR.status==="fulfilled"?cR.value:[],dir:dR.status==="fulfilled"?dR.value:[],dirComp:dcR.status==="fulfilled"?dcR.value:[],resp:rR.status==="fulfilled"?rR.value:[]});setConnected(true);setView("overview");setSelectedUser(null);}catch(e){console.error(e);setError("No pude conectar. Verificá que el Sheet sea público y las pestañas correctas.");}setLoading(false);};
const scaleVal=(val)=>{if(!config)return parseFloat(val)||0;const n=parseFloat(val);if(isNaN(n))return 0;return(n/100)*(config.scaleMax-config.scaleMin)+config.scaleMin;};
const scaleResp=(val)=>{if(!config)return parseFloat(val)||0;const n=parseFloat(val);if(isNaN(n))return 0;return((n-config.origMin)/(config.origMax-config.origMin))*(config.scaleMax-config.scaleMin)+config.scaleMin;};
const mx=config?config.scaleMax:100;
const users=useMemo(()=>{if(!data)return[];const seen=new Set();return data.total.filter(r=>{const u=r[COL.username]||r[COL.nombre];if(!u||!u.trim()||seen.has(u))return false;seen.add(u);return true;}).map(r=>({username:r[COL.username]||r[COL.nombre],name:r[COL.nombre]||r[COL.username]})).sort((a,b)=>(a.name||"").localeCompare(b.name||""));},[data]);
const handleSelectUser=(u)=>{setSelectedUser(u);setView("individual");};
const userData=useMemo(()=>data&&selectedUser?buildUserData(data,selectedUser):null,[data,selectedUser]);
const exportZip=async()=>{setExporting(true);try{const zip=new JSZip();for(const user of users){const ud=buildUserData(data,user.username);if(ud){const html=generateHTML(ud,config);const safeName=ud.name.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s,]/g,"").replace(/\s+/g,"_").substring(0,50);zip.file(`${safeName}.html`,html);}}const blob=await zip.generateAsync({type:"blob"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="reportes_evaluacion.zip";a.click();URL.revokeObjectURL(url);}catch(e){console.error(e);alert("Error generando el ZIP");}setExporting(false);};

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
      <p style={{fontSize:12,color:C.textSec,margin:0}}>La escala y los pesos se leen automáticamente de la pestaña <strong>Inputs</strong>.</p>
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
    <button onClick={()=>{setConnected(false);setData(null);setConfig(null);}} style={{padding:"7px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,background:C.white,color:C.textSec,fontSize:12,cursor:"pointer",fontFamily:font}}>⚙️</button>
  </div>
</div>);

if(view==="overview"||!userData){return(<div style={{minHeight:"100vh",background:C.bg,fontFamily:font}}>{header}<Overview data={data} config={config} scaleVal={scaleVal} mx={mx} users={users}/></div>);}

const questionsArr=Object.entries(userData.questions||{});
return(<div style={{minHeight:"100vh",background:C.bg,fontFamily:font}}>
  {header}<tt.Tip/>
  <div style={{maxWidth:960,margin:"0 auto",padding:24}}>
    {/* Hero card */}
    <div style={{background:"linear-gradient(135deg,#3B5FE5,#5B7FFF)",borderRadius:14,padding:24,marginBottom:20,color:C.white}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:16}}>
        <div><div style={{fontSize:12,opacity:0.8,marginBottom:4,fontWeight:500}}>Evaluado</div><div style={{fontSize:22,fontWeight:700,letterSpacing:"-0.02em"}}>{userData.name}</div>{userData.ciclo&&<div style={{fontSize:11,opacity:0.7,marginTop:4}}>{userData.ciclo}</div>}</div>
        <div style={{textAlign:"right"}}><div style={{fontSize:12,opacity:0.8,marginBottom:4,fontWeight:500}}>Puntaje General</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:userData.totalDif>=0?"rgba(5,150,105,0.3)":"rgba(220,38,38,0.3)",color:C.white}}>{userData.totalDif>=0?"↑":"↓"} {fmt(Math.abs(userData.totalDif))} vs prom.</span>
            <span style={{fontSize:40,fontWeight:800}}>{fmt(scaleVal(userData.totalScore))}</span>
          </div></div>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      <Card title="Competencias" icon="🎯"><div style={{display:"flex",justifyContent:"center"}}><RadarChart data={userData.competencias.map(c=>({label:c.name,value:scaleVal(c.score)}))} maxVal={mx} onHover={(e,d)=>tt.show(e,`${d.label}\n${fmt(d.value)}`)} onLeave={tt.hide}/></div></Card>
      <Card title="Valoración General" icon="📋" badge={`Prom: ${fmt(scaleVal(userData.direcciones.length>0?userData.direcciones.reduce((s,d)=>s+d.score,0)/userData.direcciones.length:0))}`}>
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:16,padding:"16px 0"}}>{userData.direcciones.map((d,i)=><VBar key={i} label={d.name} value={fmt(scaleVal(d.score))} maxVal={mx} color={C.dirs[i%6]} onHover={e=>tt.show(e,`${d.name}\n${fmt(scaleVal(d.score))}\nPeso: ${Math.round(d.peso*100)}%`)} onLeave={tt.hide}/>)}</div>
      </Card>
    </div>

    <h3 style={{fontSize:16,fontWeight:700,color:C.text,margin:"0 0 14px",letterSpacing:"-0.02em"}}>Detalle por Competencia</h3>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:22}}>
      {userData.competencias.map((comp,i)=>(<Card key={i}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h4 style={{fontSize:13,fontWeight:700,color:C.text,margin:0,maxWidth:"55%"}}>{comp.name}</h4>
          <div style={{display:"flex",alignItems:"center",gap:8}}><DiffBadge value={comp.dif}/><span style={{fontSize:22,fontWeight:800,color:C.primary}}>{fmt(scaleVal(comp.score))}</span></div>
        </div>
        {userData.compDetail[comp.name]&&Object.entries(userData.compDetail[comp.name]).map(([dir,val],j)=>(<HBar key={j} label={dir} value={fmt(scaleVal(val))} maxVal={mx} color={C.dirs[j%6]}/>))}
      </Card>))}
    </div>

    {questionsArr.length>0&&(<><h3 style={{fontSize:16,fontWeight:700,color:C.text,margin:"0 0 14px",letterSpacing:"-0.02em"}}>Preguntas</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12,marginBottom:22}}>
        {questionsArr.map(([qName,qData],i)=>{const segments=Object.entries(qData.dirs).map(([dir,val])=>({label:dir,value:val,scaled:scaleResp(val)}));
          return(<Card key={i}><div style={{display:"flex",gap:20,alignItems:"center"}}>
            <div style={{flex:1}}><h4 style={{fontSize:13,fontWeight:700,color:C.text,margin:"0 0 4px"}}>{qName}</h4>{qData.dim&&<p style={{fontSize:11,color:C.textLight,margin:"0 0 10px"}}>{qData.dim}</p>}
              {segments.map((seg,j)=>(<div key={j} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:13}}><span style={{display:"flex",alignItems:"center",gap:6,fontWeight:500}}><span style={{width:8,height:8,borderRadius:4,background:C.dirs[j%6]}}/>{seg.label}</span><span style={{fontWeight:600}}>{fmt(seg.scaled)}</span></div>))}
            </div>{segments.length>1&&<div style={{flexShrink:0}}><RingChart segments={segments.map(s=>({...s,value:s.scaled}))} maxVal={mx} size={90}/></div>}
          </div></Card>);
        })}
      </div></>)}

    <Card title="Resumen Comparativo" icon="📈"><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr style={{borderBottom:`2px solid ${C.border}`}}><th style={{textAlign:"left",padding:"10px 12px",color:C.textSec,fontWeight:600}}>Competencia</th><th style={{textAlign:"center",padding:"10px 12px",color:C.textSec,fontWeight:600}}>Puntaje</th><th style={{textAlign:"center",padding:"10px 12px",color:C.textSec,fontWeight:600}}>vs Prom.</th>{userData.direcciones.map((d,i)=><th key={i} style={{textAlign:"center",padding:"10px 12px",color:C.textSec,fontWeight:600,fontSize:10}}>{d.name}</th>)}</tr></thead>
      <tbody>{userData.competencias.map((comp,i)=>(<tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2===0?C.white:C.bg}}>
        <td style={{padding:"10px 12px",fontWeight:600,color:C.text}}>{comp.name}</td><td style={{textAlign:"center",padding:"10px 12px",fontWeight:700,color:C.primary}}>{fmt(scaleVal(comp.score))}</td><td style={{textAlign:"center",padding:"10px 12px"}}><DiffBadge value={comp.dif}/></td>
        {userData.direcciones.map((d,j)=><td key={j} style={{textAlign:"center",padding:"10px 12px",color:C.text}}>{userData.compDetail[comp.name]?.[d.name]?fmt(scaleVal(userData.compDetail[comp.name][d.name])):"-"}</td>)}
      </tr>))}</tbody>
    </table></div></Card>
    <div style={{textAlign:"center",padding:"20px 0",color:C.textLight,fontSize:11}}>Escala: {config?.scaleMin??0} - {config?.scaleMax??100}</div>
  </div>
</div>);
}

export default App;