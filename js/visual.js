/* =========================================================
   그림으로 보는 간판 설치기준 (#visual)
   - 기준 데이터: data/regulations.json (현행 기준, 출처·확인일 포함)
   - 과거 참고자료: data/historical-visual-examples.json (표현 방식만 참고, 판정에 쓰지 않음)
   - 수치는 이 파일에 직접 쓰지 않고 데이터 파일에서 읽는다.
   ========================================================= */
(function(){
"use strict";

const VG = { data:null, hist:null, err:null, loading:false };
/* 지역별 규칙 파일: 주소에 ?rules=sample 을 붙이면 data/regulations.sample.json(가상 지역 예시)을 읽는다.
   파일 이름은 영문 소문자·숫자·하이픈만 허용한다. */
const RULE_KEY = (new URLSearchParams(location.search).get("rules")||"").toLowerCase();
const RULE_FILE = /^[a-z0-9-]{1,30}$/.test(RULE_KEY) ? `data/regulations.${RULE_KEY}.json` : "data/regulations.json";
let V0 = null;        // '원안'으로 저장해 둔 입력값(수정안과 비교용)
const V = {            // 사용자 입력값(기본값은 설명용 예시)
  type:"wall", region:"general",
  floors:3, floor:1, bldgW:8, bandH:100, noWindow:false,
  signW:6, signH:80, signD:20, form:"panel",
  pFloor:2, bottom:3.5, sidewalk:"yes", out:100, len:3, thick:30, zone:"other",
  q:""
};
const PRESETS = {
  wall:[
    {n:"기준 범위 안에 든 예", d:"간판이 창문 사이 벽면 안에 들어갑니다.", v:{floors:3,floor:1,bldgW:8,bandH:100,noWindow:false,signW:6,signH:80,signD:20,form:"panel"}},
    {n:"범위를 벗어난 예", d:"간판이 위층 창문을 가리고 벽에서 많이 튀어나옵니다.", v:{floors:3,floor:1,bldgW:8,bandH:80,noWindow:false,signW:9,signH:140,signD:45,form:"panel"}},
    {n:"더 확인해야 하는 예", d:"창문이 없는 벽면이라 심의로 세로 크기를 정합니다.", v:{floors:3,floor:2,bldgW:8,bandH:100,noWindow:true,signW:6,signH:120,signD:20,form:"panel"}}
  ],
  proj:[
    {n:"기준 범위 안에 든 예", d:"아랫부분이 충분히 높고 돌출이 짧습니다.", v:{floors:4,pFloor:2,bottom:3.5,sidewalk:"yes",out:100,len:3,thick:30,zone:"other"}},
    {n:"범위를 벗어난 예", d:"간판이 낮게 달려 지나가는 사람과 가깝습니다.", v:{floors:4,pFloor:2,bottom:2.4,sidewalk:"yes",out:150,len:3,thick:30,zone:"other"}},
    {n:"더 확인해야 하는 예", d:"구역을 모르면 적용 기준이 달라질 수 있습니다.", v:{floors:4,pFloor:2,bottom:3.5,sidewalk:"yes",out:100,len:3,thick:30,zone:"other",region:"unknown"}}
  ]
};
const VERDICT = {
  ok:  {c:"x", t:"확인된 기준에 부합", m:"입력한 값은 확인된 기준 범위 안에 있습니다."},
  bad: {c:"p", t:"확인된 기준상 제한 또는 위반 가능성", m:"아래 빨간 항목이 확인된 기준 범위를 벗어납니다."},
  need:{c:"c", t:"추가 조건 확인 필요", m:"아래 '확인 필요' 항목은 담당 부서 확인이 있어야 판단할 수 있습니다."},
  none:{c:"c", t:"근거 미확인으로 판정 불가", m:"이 구역의 기준은 아직 확인하지 못해 판정하지 않습니다."}
};

const esc = s => String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmt = n => (Math.round(n*100)/100).toString();

async function load(){
  if (VG.data || VG.loading) return;
  VG.loading = true;
  try{
    const [a,b] = await Promise.all([
      fetch(RULE_FILE+"?t="+Date.now(), {cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("data/historical-visual-examples.json?t="+Date.now(), {cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null)
    ]);
    if (!a || !Array.isArray(a.rules) || !a.sources) throw new Error("empty");
    VG.data = a; VG.hist = (a.meta && a.meta.sample) ? null : b;
    if (!a.regions[V.region]) V.region = Object.keys(a.regions)[0];
  }catch(e){ VG.err = true; }
  VG.loading = false;
}

/* ---------- 기준 적용 ---------- */
function fieldVal(f){ return f==="floor" ? (V.type==="proj" ? V.pFloor : V.floor) : V[f]; }
function limitOf(c){
  if (c.ref) return V[c.ref];
  if (c.byFloor){ const fl = fieldVal("floor"); const hit = c.byFloor.find(x=>fl<=x[0]); return hit ? hit[1] : null; }
  if (c.bySidewalk) return c.bySidewalk[V.sidewalk];
  if (c.byZone) return c.byZone[V.zone] ?? c.byZone.other;
  return c.value;
}
function test(c){
  if (c.multi){ const rs = c.multi.map(test); const bad = rs.find(r=>r.s==="bad"); return bad || rs[0]; }
  if (c.when){ const w = test({field:c.when.field, op:c.when.op, value:c.when.value}); if (w.s!=="ok") return {s:"skip"}; }
  const v = fieldVal(c.field), lim = limitOf(c), u = c.unit||"";
  if (v===null || v===undefined || v==="" || lim===null || lim===undefined) return {s:"need", d:"값을 확인할 수 없습니다."};
  if (c.op==="==")  return {s: v===lim ? "ok":"bad", d: v===lim ? "" : "입력한 형태가 기준과 다릅니다."};
  if (c.op==="between") return {s: (v>=lim[0]&&v<=lim[1])?"ok":"bad", d:`입력 ${fmt(v)}${u} · 기준 ${lim[0]}~${lim[1]}${u}`};
  const ok = c.op==="<=" ? v<=lim : v>=lim;
  return {s: ok?"ok":"bad", d:`입력 ${fmt(v)}${u} · 기준 ${fmt(lim)}${u} ${c.op==="<="?"이내":"이상"}`};
}
function meta(){ return VG.data.meta || {}; }
function applicable(){
  const D = VG.data, t = V.type, reg = V.region;
  const regs = (meta().layers && meta().layers[reg]) || [reg];
  return D.rules.filter(r => regs.includes(r.region) && (r.sign_type===t || r.sign_type==="all"));
}
function evaluate(){
  const rules = applicable();
  const rows = rules.map(r=>{
    const src = VG.data.sources[r.source];
    if (r.status==="unverified") return {r, src, s:"none", d:"기준을 확인하지 못해 판정하지 않습니다."};
    if (!r.check) return {r, src, s:"info", d:""};
    if (r.id===drawRule("wallHeight") && V.noWindow) return {r, src, s:"need", d:"창문이 없는 벽면은 심의위원회 심의로 세로 크기를 정합니다."};
    const t = test(r.check);
    return {r, src, s:t.s, d:t.d||""};
  }).filter(x=>x.s!=="skip");
  const judged = rows.filter(x=>["ok","bad","need"].includes(x.s));
  let overall;
  if ((meta().no_verdict_regions||[]).includes(V.region) || !judged.length) overall = "none";
  else if (rows.some(x=>x.s==="bad")) overall = "bad";
  else if (rows.some(x=>x.s==="need") || (meta().uncertain_regions||[]).includes(V.region)) overall = "need";
  else overall = "ok";
  return {rows, overall};
}
function drawRule(k){ const m = (meta().draw||{})[k] || {}; return m[V.region] || m.default; }
function withState(s, fn){ const bak = Object.assign({}, V); Object.assign(V, s); try{ return fn(); } finally{ Object.assign(V, bak); } }
function inputsValid(){
  const need = V.type==="wall" ? ["floors","floor","bldgW","bandH","signW","signH","signD"] : ["floors","pFloor","bottom","out","len","thick"];
  for (const k of need){ const v = V[k]; if (v===null || !(v>0)) return false; }
  if (V.type==="wall" && V.floor>V.floors) return false;
  if (V.type==="proj" && V.pFloor>V.floors) return false;
  return true;
}

/* ---------- 그림(SVG) ---------- */
const C = { wall:"#eef1f8", line:"#c5cde0", win:"#cfe0ff", ok:"#14a36b", bad:"#d43b3b", sign:"#3f6ef5", ink:"#30364a" };
function defs(id){
  return `<defs><pattern id="${id}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fde3e3"/><rect width="3" height="6" fill="${C.bad}"/></pattern>
  <pattern id="${id}g" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#e3f6ee"/><circle cx="4" cy="4" r="1.1" fill="${C.ok}"/></pattern></defs>`;
}
function dim(x1,y1,x2,y2,label,color,side){
  const horiz = y1===y2, mx=(x1+x2)/2, my=(y1+y2)/2;
  const tick = horiz ? `M${x1},${y1-4}V${y1+4}M${x2},${y2-4}V${y2+4}` : `M${x1-4},${y1}H${x1+4}M${x2-4},${y2}H${x2+4}`;
  const tx = horiz ? mx : (side==="left" ? x1-6 : x1+6), ty = horiz ? y1+14 : my+4;
  return `<path d="M${x1},${y1}L${x2},${y2}${tick}" stroke="${color}" stroke-width="1.5" fill="none"/>
    <text x="${tx}" y="${ty}" font-size="11" font-weight="700" fill="${color}" text-anchor="${horiz?"middle":(side==="left"?"end":"start")}">${esc(label)}</text>`;
}
function drawWall(){
  const W=360, H=300, padL=58, padR=70, padT=16, padB=40, FH=3.3;
  const bw=Math.max(2,Math.min(V.bldgW,40)), n=Math.max(1,Math.min(V.floors,10));
  const sc=Math.min((W-padL-padR)/bw,(H-padT-padB)/(n*FH));
  const bx=padL+((W-padL-padR)-bw*sc)/2, gy=H-padB, bh=n*FH*sc, by=gy-bh;
  const band=Math.max(0.2,Math.min(V.bandH/100,FH-0.6));
  let s=`<rect x="${bx}" y="${by}" width="${bw*sc}" height="${bh}" fill="${C.wall}" stroke="${C.line}" stroke-width="1.5"/>`;
  for(let f=1;f<=n;f++){
    const top=gy-f*FH*sc, base=gy-(f-1)*FH*sc, wy=top+band*sc, wh=base-wy-(f===1?0:0.25*sc);
    s+=`<line x1="${bx}" x2="${bx+bw*sc}" y1="${top}" y2="${top}" stroke="${C.line}" stroke-width="1"/>`;
    if(!(V.noWindow && f===V.floor+1)) {
      if(!(V.noWindow && f===V.floor)){
        const cols=Math.max(2,Math.round(bw/2.6)), gap=bw*sc/cols;
        for(let i=0;i<cols;i++) s+=`<rect x="${bx+i*gap+gap*0.12}" y="${wy}" width="${gap*0.76}" height="${Math.max(4,wh)}" rx="2" fill="${C.win}" stroke="#a9c1f5" stroke-width="1"/>`;
      }
    }
    s+=`<text x="${bx-8}" y="${(top+base)/2+4}" font-size="10.5" fill="#8a90a3" text-anchor="end">${f}층</text>`;
  }
  // 기준 범위(설치하는 층의 창문 사이 벽면 × 건물 가로폭)
  const fTop=gy-V.floor*FH*sc, ax=bx, ay=fTop, aw=bw*sc, ah=band*sc;
  if(!V.noWindow) s+=`<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" fill="url(#vwg)" stroke="${C.ok}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  // 내 간판
  const sw=V.signW*sc, sh=V.signH/100*sc, sx=bx+(bw*sc-sw)/2, sy=ay+ah/2-sh/2;
  const cid="vwc";
  s+=`<clipPath id="${cid}"><rect x="${ax}" y="${V.noWindow?by:ay}" width="${aw}" height="${V.noWindow?bh:ah}"/></clipPath>`;
  s+=`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#vwh)" stroke="${C.bad}" stroke-width="1.5"/>`;
  s+=`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${C.sign}" clip-path="url(#${cid})"/>`;
  s+=`<text x="${bx+bw*sc/2}" y="${sy+sh/2+4}" font-size="${Math.max(9,Math.min(13,sh*0.5))}" font-weight="700" fill="#fff" text-anchor="middle">내 간판</text>`;
  s+=`<line x1="${padL-30}" x2="${W-20}" y1="${gy}" y2="${gy}" stroke="${C.ink}" stroke-width="2"/>`;
  s+=dim(bx,gy+12,bx+bw*sc,gy+12,`건물 가로폭 ${fmt(V.bldgW)}m`,C.ok);
  if(!V.noWindow) s+=dim(bx+bw*sc+10,ay,bx+bw*sc+10,ay+ah,`벽면 ${fmt(V.bandH)}cm`,C.ok,"right");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="건물 앞모습 그림. ${V.floors}층 건물의 ${V.floor}층 위 벽면에 가로 ${fmt(V.signW)}미터, 세로 ${fmt(V.signH)}센티미터 간판을 놓은 모습">${defs("vw")}${s}</svg>`;
}
function drawSide(limit){
  const W=160,H=120, wx=40, sc=1.6, d=Math.min(V.signD,90), lim=limit||30;
  const over=Math.max(0,d-lim);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="건물 옆모습 그림. 간판이 벽에서 ${fmt(V.signD)}센티미터 튀어나온 모습">${defs("vs")}
    <rect x="${wx-22}" y="8" width="22" height="100" fill="${C.wall}" stroke="${C.line}"/>
    <text x="${wx-11}" y="64" font-size="10" fill="#8a90a3" text-anchor="middle">벽</text>
    <rect x="${wx}" y="40" width="${lim*sc}" height="36" fill="url(#vsg)" stroke="${C.ok}" stroke-dasharray="4 3"/>
    <rect x="${wx}" y="44" width="${Math.min(d,lim)*sc}" height="28" fill="${C.sign}"/>
    ${over?`<rect x="${wx+lim*sc}" y="44" width="${over*sc}" height="28" fill="url(#vsh)" stroke="${C.bad}"/>`:""}
    ${dim(wx,92,wx+lim*sc,92,`기준 ${lim}cm`,C.ok)}
    <text x="${wx}" y="30" font-size="10.5" font-weight="700" fill="${C.ink}">돌출 ${fmt(V.signD)}cm</text></svg>`;
}
function drawProj(limits){
  const W=360,H=300,padL=40,padB=40,padT=16,FH=3.3, n=Math.max(1,Math.min(V.floors,10));
  const bwm=6, totalH=n*FH, sc=Math.min((H-padT-padB)/totalH, 34);
  const gy=H-padB, bx=padL, bw=bwm*sc*0.9, bh=totalH*sc, by=gy-bh, wallX=bx+bw;
  let s=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${C.wall}" stroke="${C.line}" stroke-width="1.5"/>`;
  for(let f=1;f<=n;f++){ const top=gy-f*FH*sc, base=gy-(f-1)*FH*sc;
    s+=`<line x1="${bx}" x2="${wallX}" y1="${top}" y2="${top}" stroke="${C.line}"/>`;
    for(let i=0;i<2;i++) s+=`<rect x="${bx+bw*(0.12+i*0.46)}" y="${top+0.8*sc}" width="${bw*0.3}" height="${Math.max(4,(base-top)-1.2*sc)}" rx="2" fill="${C.win}" stroke="#a9c1f5"/>`;
    s+=`<text x="${bx-6}" y="${(top+base)/2+4}" font-size="10.5" fill="#8a90a3" text-anchor="end">${f}층</text>`; }
  const minB=limits.bottom, maxOut=limits.out/100;
  // 기준 범위: 지면에서 minB 이상 ~ 건물 벽면 높이, 벽에서 maxOut 이내
  const zy=by, zh=Math.max(0,bh-minB*sc);
  s+=`<rect x="${wallX}" y="${zy}" width="${maxOut*sc}" height="${zh}" fill="url(#vpg)" stroke="${C.ok}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  const sx=wallX, sw=V.out/100*sc, sh=V.len*sc, sy=gy-V.bottom*sc-sh;
  s+=`<clipPath id="vpc"><rect x="${wallX}" y="${zy}" width="${maxOut*sc}" height="${zh}"/></clipPath>`;
  s+=`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#vph)" stroke="${C.bad}" stroke-width="1.5"/>`;
  s+=`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${C.sign}" clip-path="url(#vpc)"/>`;
  s+=`<line x1="${padL-20}" x2="${W-20}" y1="${gy}" y2="${gy}" stroke="${C.ink}" stroke-width="2"/>`;
  s+=`<text x="${W-24}" y="${gy+16}" font-size="10.5" fill="#8a90a3" text-anchor="end">${V.sidewalk==="yes"?"인도":"인도 없는 도로"}</text>`;
  const px=wallX+maxOut*sc+26;
  s+=`<circle cx="${px}" cy="${gy-1.6*sc}" r="${0.14*sc+3}" fill="#9aa3b8"/><rect x="${px-0.2*sc-2}" y="${gy-1.45*sc+4}" width="${0.4*sc+4}" height="${1.45*sc-4}" rx="4" fill="#9aa3b8"/>`;
  s+=dim(px+24,gy-minB*sc,px+24,gy,`지면에서 ${fmt(minB)}m`,C.ok,"right");
  s+=dim(wallX,by-6,wallX+maxOut*sc,by-6,"",C.ok);
  s+=`<text x="${wallX+maxOut*sc+6}" y="${by+4}" font-size="11" font-weight="700" fill="${C.ok}">벽에서 ${fmt(limits.out)}cm</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="건물 앞모습 그림. 벽에서 ${fmt(V.out)}센티미터 튀어나온 돌출간판이 지면에서 ${fmt(V.bottom)}미터 높이에 달린 모습">${defs("vp")}${s}</svg>`;
}

/* ---------- 화면 ---------- */
function srcLine(x){
  const st = VG.data.status_labels[x.r.status] || x.r.status;
  const link = x.src && x.src.url ? `<a href="${esc(x.src.url)}" target="_blank" rel="noopener">${esc(x.src.name.split(" (")[0])}</a>` : "";
  return `<small class="vg-src">근거: ${link} ${esc(x.r.article)} · ${esc(st)} · 확인일 ${esc(x.r.checked)}</small>`;
}
function rowHtml(x){
  const lab = {ok:["맞음","ok"], bad:["범위 벗어남","bad"], need:["확인 필요","need"], none:["판정 불가","need"], info:["함께 확인","info"]}[x.s];
  return `<li class="vg-row ${lab[1]}"><span class="vg-badge ${lab[1]}">${lab[0]}</span>
    <div><b>${esc(x.r.condition)}</b><p>${esc(x.r.rule)}${x.d?` <em>(${esc(x.d)})</em>`:""}</p>
    ${x.r.exceptions?`<p class="vg-exc">예외·참고: ${esc(x.r.exceptions)}</p>`:""}${srcLine(x)}</div></li>`;
}
const fld = (k,label,unit,step,min,max) => `<label class="fld">${label}<span class="vg-unit"><input type="number" inputmode="decimal" data-k="${k}" value="${V[k]??""}" step="${step}" min="${min}" max="${max}" aria-label="${label} (${unit})"><i>${unit}</i></span></label>`;
const sel = (k,label,opts) => `<label class="fld">${label}<select data-k="${k}">${opts.map(o=>`<option value="${o[0]}" ${String(V[k])===String(o[0])?"selected":""}>${o[1]}</option>`).join("")}</select></label>`;

function render(el){
  const head = `<h2>${typeof sign==="function"?sign("visual"):""}그림으로 보는 간판 설치기준</h2>
    <p class="lead">간판 종류와 크기를 넣으면 건물 그림 위에 기준 범위와 내 간판을 함께 보여 드립니다.</p>`;
  if (VG.err){ el.innerHTML = head + `<div class="note warn">기준 자료를 불러오지 못했습니다. 잠시 뒤 다시 열어 보시거나 담당 부서(${CONTACT.tel})로 문의해 주십시오.</div>`; return; }
  if (!VG.data){ el.innerHTML = head + `<p class="lead">기준 자료를 불러오는 중입니다…</p>`; load().then(()=>{ if(location.hash==="#visual") render(el); }); return; }
  const D = VG.data, valid = inputsValid();
  const ev = valid ? evaluate() : null;
  const vd = ev ? VERDICT[ev.overall] : null;
  const lim = id => { const r = D.rules.find(x=>x.id===id); return r && r.check ? r.check : {}; };
  const outC = lim(drawRule("projOut"));
  const limitsNow = () => ({ bottom: (lim(drawRule("projBottom")).bySidewalk||{})[V.sidewalk], out: outC.multi ? (outC.multi[0]||{}).value : outC.value });
  const projLimits = limitsNow();
  const M = meta();
  const pic = !valid ? `<div class="vg-empty">크기와 층수를 모두 0보다 큰 숫자로 넣어 주십시오.${(V.type==="wall"?V.floor:V.pFloor)>V.floors?" 설치하는 층이 건물 층수보다 높습니다.":""}</div>`
    : V.type==="wall" ? `<div class="vg-pics"><figure>${drawWall()}<figcaption>앞에서 본 모습</figcaption></figure><figure class="side">${drawSide(lim(drawRule("wallProj")).value)}<figcaption>옆에서 본 모습</figcaption></figure></div>`
    : `<div class="vg-pics"><figure>${drawProj(projLimits)}<figcaption>앞에서 본 모습</figcaption></figure></div>`;
  const regions = Object.entries(D.regions);
  const floorsOpt = Array.from({length:10},(_,i)=>[i+1,(i+1)+"층"]);
  const inputs = V.type==="wall" ? `
      ${sel("floors","건물 전체 층수",floorsOpt)}${sel("floor","간판을 다는 층",floorsOpt)}
      ${fld("bldgW","건물 가로폭","m",0.1,1,60)}${fld("bandH","위·아래층 창문 사이 벽면 높이","cm",5,10,400)}
      ${fld("signW","간판 가로","m",0.1,0.1,60)}${fld("signH","간판 세로(글자 높이)","cm",5,5,500)}
      ${fld("signD","벽에서 튀어나오는 폭","cm",1,1,200)}${sel("form","간판 형태",[["panel","판류형(판에 표시)"],["solid","입체형(글자를 따로 붙임)"]])}
      <label class="vg-chk"><input type="checkbox" data-k="noWindow" ${V.noWindow?"checked":""}> 간판을 달 벽면에 창문이 없습니다</label>` : `
      ${sel("floors","건물 전체 층수",floorsOpt)}${sel("pFloor","간판을 다는 층",floorsOpt)}
      ${fld("bottom","간판 아랫부분 높이(지면에서)","m",0.1,0.1,40)}${sel("sidewalk","간판 아래 도로",[["yes","인도가 있음"],["no","인도가 없음"]])}
      ${fld("out","벽에서 바깥쪽 끝까지","cm",5,5,400)}${fld("len","간판 세로 길이","m",0.1,0.1,40)}
      ${fld("thick","간판 두께","cm",1,1,200)}${sel("zone","용도지역",[["other","상업지역이 아님 / 모름"],["commercial","상업지역"]])}`;
  const q = V.q.trim();
  const hits = q ? D.rules.filter(r=>(r.condition+r.rule+r.exceptions+D.regions[r.region]).includes(q)) : [];
  const H = VG.hist;
  /* 원안·수정안 비교 */
  const sameType = V0 && V0.type===V.type;
  const ev0 = sameType ? withState(V0, ()=> inputsValid() ? evaluate() : null) : null;
  const pic0 = ev0 ? withState(V0, ()=> V.type==="wall" ? drawWall() : drawProj(limitsNow())) : "";
  const picNow = valid ? (V.type==="wall" ? drawWall() : drawProj(projLimits)) : "";
  const LBL = V.type==="wall" ? {floor:"다는 층",bldgW:"건물 가로폭(m)",bandH:"벽면 높이(cm)",signW:"간판 가로(m)",signH:"간판 세로(cm)",signD:"돌출 폭(cm)",form:"형태",region:"구역",noWindow:"창문 없는 벽면"}
    : {pFloor:"다는 층",bottom:"아랫부분 높이(m)",out:"돌출(cm)",len:"세로 길이(m)",thick:"두께(cm)",sidewalk:"인도",zone:"용도지역",region:"구역"};
  const show = (k,x) => k==="region" ? (D.regions[x]||x) : k==="form" ? (x==="panel"?"판류형":"입체형") : k==="noWindow" ? (x?"예":"아니오") : k==="sidewalk" ? (x==="yes"?"있음":"없음") : k==="zone" ? (x==="commercial"?"상업지역":"상업지역 아님") : x;
  const diffs = ev0 ? Object.keys(LBL).filter(k=>V0[k]!==V[k]).map(k=>`<li><b>${LBL[k]}</b> ${esc(show(k,V0[k]))} → ${esc(show(k,V[k]))}</li>`) : [];
  const badN = e => e.rows.filter(x=>x.s==="bad").length;
  const cmp = !ev ? "" : !V0 ? `<div class="vg-cmp-start"><button class="btn" id="vgKeep">지금 값을 '원안'으로 저장</button><span>저장한 뒤 값을 고치면 원안과 수정안을 나란히 비교합니다.</span></div>`
    : !sameType ? `<div class="vg-cmp-start"><span>저장한 원안은 다른 종류의 간판입니다.</span><button class="btn" id="vgKeep">지금 값으로 다시 저장</button><button class="btn" id="vgDrop">원안 지우기</button></div>`
    : `<div class="vg-cmp" id="vgCompare"><h3 class="h3">원안과 수정안 비교</h3>
        <div class="vg-cmp-grid">
          <figure><figcaption><b>원안</b><span class="vg-badge ${ev0.overall==="ok"?"ok":ev0.overall==="bad"?"bad":"need"}">${VERDICT[ev0.overall].t}</span></figcaption>${pic0}<small>벗어난 항목 ${badN(ev0)}건</small></figure>
          <figure><figcaption><b>수정안</b><span class="vg-badge ${ev.overall==="ok"?"ok":ev.overall==="bad"?"bad":"need"}">${vd.t}</span></figcaption>${picNow}<small>벗어난 항목 ${badN(ev)}건</small></figure>
        </div>
        ${diffs.length?`<ul class="vg-diff">${diffs.join("")}</ul>`:`<p class="vg-help">아직 원안과 같은 값입니다. 크기나 구역을 바꿔 보십시오.</p>`}
        <div class="vg-act"><button class="btn" id="vgBack">원안 값으로 되돌리기</button><button class="btn" id="vgDrop">비교 끝내기</button></div></div>`;
  el.innerHTML = head + `
    ${M.sample?`<div class="vg-sample" id="vgSample"><b>가상 지역 예시 화면입니다.</b> 규칙 파일을 바꿔 끼우는 구조를 보여 주기 위한 것으로, 여기 나오는 구역과 수치는 실제 기준이 아닙니다.</div>`:""}
    <div class="vg-step"><span>1</span><b>어떤 간판인가요?</b></div>
    <div class="opts vg-types">
      <button class="opt ${V.type==="wall"?"sel":""}" data-type="wall"><b>벽면 이용 간판(가로형)</b><span>가게 위 벽면에 가로로 길게 붙이는 간판</span></button>
      <button class="opt ${V.type==="proj"?"sel":""}" data-type="proj"><b>돌출간판</b><span>벽에서 튀어나오게 다는 간판</span></button>
      <button class="opt" data-go="standards"><b>그 밖의 간판</b><span>지주·옥상·입간판·현수막은 종류별 기준에서 안내</span></button>
    </div>
    <div class="vg-step"><span>2</span><b>가게가 어느 구역에 있나요?</b></div>
    <div class="tabs vg-reg" role="group" aria-label="구역 선택">${regions.map(([k,n])=>`<button class="${V.region===k?"on":""}" data-reg="${k}" aria-pressed="${V.region===k}">${esc(n)}</button>`).join("")}</div>
    <p class="vg-help">${esc(M.zone_help||"")} ${M.zone_help_url?`내 가게가 해당하는지는 <a href="${esc(M.zone_help_url)}" target="_blank" rel="noopener">${esc(M.zone_help_link||"자료")}</a>나 전화(${CONTACT.tel})로 확인해 주십시오.`:""}</p>
    <div class="vg-step"><span>3</span><b>건물과 간판 크기를 넣어 보세요</b></div>
    <div class="tabs vg-pre" role="group" aria-label="설명용 예시">${PRESETS[V.type].map((p,i)=>`<button data-pre="${i}" title="${esc(p.d)}">${esc(p.n)}</button>`).join("")}</div>
    <p class="vg-help">위 버튼은 이해를 돕기 위한 <b>설명용 예시</b>이며 실제 허가·신고 사례가 아닙니다.</p>
    <div class="vg-sim">
      <div class="vg-in">${inputs}</div>
      <div class="vg-out" aria-live="polite">${pic}
        <ul class="vg-legend"><li><i class="lg g"></i>초록 점무늬·점선: 확인된 기준 범위</li><li><i class="lg b"></i>파란색: 내 간판</li><li><i class="lg r"></i>빨간 빗금: 기준 범위를 벗어난 부분</li></ul>
      </div>
    </div>
    ${ev ? `<div class="result ${vd.c} vg-result" id="vgResult"><div class="big">${vd.t}</div><div>${vd.m}</div></div>
    <div class="vg-sum" id="vgSummary">
      <h3 class="h3">${typeof ic==="function"?ic("clipboard-list"):""} 안내 결과 요약</h3>
      <p class="vg-cond">${esc(V.type==="wall"?"벽면 이용 간판(가로형)":"돌출간판")} · ${esc(D.regions[V.region])} · ${V.type==="wall"
        ? `${V.floors}층 건물 ${V.floor}층 · 건물 가로폭 ${fmt(V.bldgW)}m · 간판 ${fmt(V.signW)}m × ${fmt(V.signH)}cm · 돌출 ${fmt(V.signD)}cm · ${V.form==="panel"?"판류형":"입체형"}${V.noWindow?" · 창문 없는 벽면":""}`
        : `${V.floors}층 건물 ${V.pFloor}층 · 아랫부분 ${fmt(V.bottom)}m · 돌출 ${fmt(V.out)}cm · 세로 ${fmt(V.len)}m · 두께 ${fmt(V.thick)}cm`}</p>
      <ul class="vg-rows">${ev.rows.filter(x=>x.s!=="none"||ev.overall==="none").map(rowHtml).join("")}</ul>
      ${ev.overall!=="none" && ev.rows.some(x=>x.s==="none") ? `<details class="vg-more"><summary>아직 확인하지 못해 비교하지 않은 기준 ${ev.rows.filter(x=>x.s==="none").length}건</summary><ul class="vg-rows">${ev.rows.filter(x=>x.s==="none").map(rowHtml).join("")}</ul></details>` : ""}
      ${cmp}
      <ul class="vg-foot">
        ${(M.uncertain_regions||[]).includes(V.region)&&!M.sample?`<li>구역을 모르는 상태라 경기도 조례 일반 기준만 비교했습니다. 특정구역 안이면 입체형 설치, 글자 크기 등 기준이 더해집니다.</li>`:""}
        ${(M.no_verdict_regions||[]).includes(V.region)?`<li>정비시범구역은 별도 고시의 표시방법을 따르며, 그 내용은 아직 확인하지 못했습니다. 담당 부서(${CONTACT.tel})에 문의해 주십시오.</li>`:""}
        <li>이해를 돕기 위한 안내이며 허가증이나 적합 확인서가 아닙니다. 허가·신고 여부는 담당 부서가 검토해 결정합니다.</li>
      </ul>
      <div class="vg-act"><button class="btn" id="vgPrint">${typeof ic==="function"?ic("file-down"):""} 인쇄·PDF로 저장</button>
        <button class="btn primary" onclick="go('diagnose')">→ 허가·신고 대상 자가진단</button>
        <button class="btn" onclick="go('contact')">담당 부서 문의</button></div>
    </div>` : ""}
    <h3 class="h3">${typeof ic==="function"?ic("search"):""} 기준 찾아보기 <small>검색형 안내 · AI 챗봇이 아닙니다</small></h3>
    <div class="vg-search"><input id="vgQ" value="${esc(V.q)}" placeholder="예) 돌출, 창문, 글자 크기, 입체형" aria-label="기준 검색어"></div>
    <div id="vgHits">${q ? (hits.length ? `<ul class="vg-rows">${hits.map(r=>rowHtml({r,src:D.sources[r.source],s:r.status==="unverified"?"none":"info",d:"적용: "+D.regions[r.region]})).join("")}</ul>` : `<p class="vg-help">확인된 기준 자료에서 찾지 못했습니다. 근거 없이 답하지 않으니 담당 부서(${CONTACT.tel})에 문의해 주십시오.</p>`) : `<p class="vg-help">확인해 둔 기준 ${D.rules.length}건 안에서만 찾아 보여 드립니다.</p>`}</div>
    ${H && M.compare ? `<details class="vg-hist"><summary>이 그림 안내는 어떻게 만들었나요?</summary><div class="a">
      <p>옛 안내 자료(${esc(H.source_title)})가 건물 사진 위에 <b>빨간색으로 한도</b>, <b>초록색으로 기준 치수</b>를 그려 설명한 방식을 참고해 그림 안내를 만들었습니다. 그 자료의 사진과 수치는 쓰지 않았습니다.</p>
      <table class="vg-tbl"><thead><tr><th>항목</th><th>옛 자료(2005년, 참고만)</th><th>지금 확인한 기준</th></tr></thead><tbody>
        <tr><td>가로</td><td>${esc((H.items.find(i=>i.id==="H-05")||{}).extracted_rule||"")}</td><td>${esc((D.rules.find(r=>r.id===M.compare.width)||{}).rule||"")}</td></tr>
        <tr><td>세로</td><td>${esc((H.items.find(i=>i.id==="H-02")||{}).extracted_rule||"")}</td><td>${esc((D.rules.find(r=>r.id===M.compare.height)||{}).rule||"")}</td></tr>
        <tr><td>돌출</td><td>${esc((H.items.find(i=>i.id==="H-04")||{}).extracted_rule||"")}</td><td>${esc((D.rules.find(r=>r.id===M.compare.proj)||{}).rule||"")}</td></tr>
      </tbody></table>
      <p>옛 자료와 지금 기준은 이렇게 다를 수 있어, 판정에는 출처와 확인일이 있는 현행 기준 자료만 씁니다. 기준 자료 갱신일: ${esc(D.updated)}</p></div></details>` : ""}
    ${typeof bizBox==="function" ? bizBox("기준에 맞는 간판 제작과 신청 서류 준비는 등록된 옥외광고사업자와 상의하십시오.") : ""}`;

  const redraw = keep => { const id = keep && document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null; const sy = window.scrollY;
    render(el); window.scrollTo(0,sy);
    if (id){ const n = el.querySelector(`[data-k="${id}"]`); if(n){ n.focus(); try{ const l=n.value.length; n.setSelectionRange && n.type!=="number" && n.setSelectionRange(l,l);}catch(e){} } } };
  el.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{ V.type=b.dataset.type; redraw(); });
  el.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  el.querySelectorAll("[data-reg]").forEach(b=>b.onclick=()=>{ V.region=b.dataset.reg; redraw(); });
  el.querySelectorAll("[data-pre]").forEach(b=>b.onclick=()=>{ const p=PRESETS[V.type][+b.dataset.pre]; const pv=Object.assign({},p.v); if(pv.region && !VG.data.regions[pv.region]) delete pv.region; Object.assign(V,pv); redraw(); });
  el.querySelectorAll("[data-k]").forEach(n=>{
    const k=n.dataset.k;
    const set=()=>{ V[k] = n.type==="checkbox" ? n.checked : (n.tagName==="SELECT" && !["floors","floor","pFloor"].includes(k)) ? n.value : num(n.value); };
    if (n.tagName==="SELECT" || n.type==="checkbox") n.onchange=()=>{ set(); redraw(true); };
    else { n.onchange=()=>{ set(); redraw(true); }; n.oninput=()=>{ set(); }; }
  });
  const snap = () => { V0 = Object.assign({}, V); delete V0.q; };
  const kp = el.querySelector("#vgKeep"); if (kp) kp.onclick=()=>{ snap(); redraw(); };
  const dp = el.querySelector("#vgDrop"); if (dp) dp.onclick=()=>{ V0=null; redraw(); };
  const bk = el.querySelector("#vgBack"); if (bk) bk.onclick=()=>{ Object.assign(V, V0); redraw(); };
  const pr = el.querySelector("#vgPrint"); if (pr) pr.onclick=()=>window.print();
  const qi = el.querySelector("#vgQ");
  if (qi){ let t; qi.oninput=()=>{ V.q=qi.value; clearTimeout(t); t=setTimeout(()=>{ const sy=window.scrollY; render(el); window.scrollTo(0,sy); const n=el.querySelector("#vgQ"); n.focus(); n.setSelectionRange(n.value.length,n.value.length); },350); }; }
}

window.drawVisual = render;
window.__VG = { V, VG, evaluate, load, keep(){ V0 = Object.assign({}, V); }, drop(){ V0=null; }, file: RULE_FILE };   // 자동화 테스트용
})();
