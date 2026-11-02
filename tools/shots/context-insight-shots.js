'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const pw=require('/opt/node22/lib/node_modules/playwright');
const ROOT='/home/user/velvet-viking-valhalla-2';
const {loadApp}=require(ROOT+'/test/harness.js');const {buildPlan}=require(ROOT+'/test/fixtures.js');
const OUT=process.argv[2]; fs.mkdirSync(OUT,{recursive:true});
const T=new Date().toISOString().slice(0,10);
function mk(off){const a=loadApp({pinnedDate:T+'T09:00:00Z'});a.showToast=()=>{};a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};
 buildPlan(a,{distanceKey:'half',volume:55,weeks:14,lthr:172,maxHR:188,startDate:a.addDays(T,off)});
 a.state.setup.purpose='race'; a.state.setup.freqRepairIIReconciled=true; a.state.healthConsent={granted:true,at:'x'};
 a.state.days.forEach(d=>{if(d.date>=T||d.type==='rest')return;d.completed=true;
   d.actual={km:d.km,pace:'5:05',paceUnit:'km',hr:148,rpe:5,feel:'good',notes:''};});
 return a;}
const K=a=>'programme:'+a.insightBlockKey();
/* ISOLATE ONE INSIGHT WITHOUT FAKING ONE. Every other candidate that is
   genuinely true is marked as already seen, so the one under test is the one
   the real selector returns -- the priority order is exercised rather than
   bypassed. Written this way after a date rollover quietly turned three
   frames into the same insight: hard-coded week offsets are not stable
   across days, and a screenshot that silently photographs the wrong thing is
   worse than one that fails. */
function only(a, kind){
  a.insightCandidates().forEach(function(c){ if (c.kind !== kind) a.insightRecord(c.key, true); });
  a.state.insights.shownOn = null;
  return a;
}
/* The first week whose phase differs from the week before it, found from the
   plan rather than assumed, so this lands on a real boundary whatever today
   happens to be. */
function daysBetween(a,b){
  return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
}
function boundaryWeek(a, phase){
  for (var w = 2; w <= (a.state.setup.planWeeks || 14); w++)
    if (a.trainingPhase(w) === phase && a.trainingPhase(w - 1) !== phase) return w;
  return null;
}
const SCENES=[
 {tag:'programme', build:()=>only(mk(-8),'programme')},
 ...['Build','Peak','Taper'].map(ph=>({tag:'phase-'+ph.toLowerCase(), build:()=>{
    /* Plan weeks are Monday-aligned, so a week number is not a fixed number of
       days from the start date -- the estimate below is read off the fixture's
       own week range and then verified against the real selector, widening by a
       day at a time until today genuinely sits in the week that enters PH. */
    const probe=mk(-8), b=boundaryWeek(probe,ph);
    if(!b) throw new Error('the fixture never enters '+ph);
    const est=-8+daysBetween(probe.weekDateRange(b).start,T);
    for(let k=0;k<=12;k++) for(const off of (k?[est-k,est+k]:[est])){
      const a=mk(off);
      if(a.insightCandidates().some(c=>c.kind==='phase'&&c.phase===ph)) return only(a,'phase');
    }
    throw new Error('could not land today in the week that enters '+ph);}})),
 {tag:'new-workout', build:()=>{const a=mk(-35);
    const d=a.state.days.filter(x=>x.date===a.addDays(T,1))[0];
    if(!d) throw new Error('no day tomorrow to make unfamiliar');
    d.type='over_under';d.km=10;d.title='Over-Under: 3x(1km/1km)';
    d.desc='2km warm-up. 3 cycles of 1km under threshold straight into 1km over, continuous. 1km cool-down.';
    d.prescription={v:a.PRESCRIPTION_VERSION,archetype:'over_under',params:{cycles:3}};
    return only(a,'workout');}},
 {tag:'threshold', build:()=>{const a=mk(-35);
    a.state.setup.thresholdPaceSource='calibration';a.state.setup.thresholdPaceSecPerKm=277;
    return only(a,'threshold');}},
 {tag:'restriction-return', build:()=>{const a=mk(-35);
    a.declareRestriction('none',a.addDays(T,10));a.state.setup.restriction.from=a.addDays(T,-14);a.endRestriction();
    return only(a,'restriction_return');}},
 {tag:'deuce-card', build:()=>{const a=mk(-35);
    a.state.insights.quietBlockId=a.insightBlockKey();   // no modal on this one
    const d=a.state.days.filter(x=>x.date===T)[0]||a.state.days.filter(x=>x.date>=T)[0];
    const t=a.intervalWorkoutText({sets:2,reps:4,m:400,t:'interval'},9);
    d.type='interval';d.km=9;d.title=t.title;d.desc=t.desc;
    d.prescription={v:a.PRESCRIPTION_VERSION,archetype:'deuce',params:{sets:2,reps:4,m:400}};
    return a;}, noModal:true},
];
/* AND EACH FRAME MUST PROVE IT PHOTOGRAPHED THE INSIGHT IT CLAIMS. */
const EXPECT_TITLE={ programme:/this block is for/i, 'phase-build':/looks different/i,
  'phase-peak':/looks different/i, 'phase-taper':/looks different/i,
  'new-workout':/Something new/i, threshold:/changed source/i, 'restriction-return':/not doing/i };
const MIME={'.png':'image/png','.svg':'image/svg+xml','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'};
const html=fs.readFileSync(ROOT+'/protected/velvet-viking-valhalla.html','utf8');
const srv=http.createServer((q,r)=>{const u=decodeURIComponent((q.url||'/').split('?')[0]);
 if(u==='/'){r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return r.end(html);}
 const f=path.join(ROOT,u.replace(/^\/+/,''));if(f.indexOf(ROOT)!==0||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('x');}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
srv.listen(0,'127.0.0.1',async()=>{
 const url='http://127.0.0.1:'+srv.address().port+'/';
 const br=await pw.chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for(const sc of SCENES){ for(const theme of ['dark','light']){
   const a=sc.build();
   const ctx=await br.newContext({viewport:{width:390,height:900},deviceScaleFactor:2,isMobile:true,colorScheme:theme});
   const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
   await p.addInitScript(([k,s])=>localStorage.setItem(k,s),[a.STORAGE_KEY,
     JSON.stringify(Object.assign({},JSON.parse(JSON.stringify(a.state)),{view:'today',theme,themeExplicit:true}))]);
   await p.goto(url,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1100);
   if(process.env.DBG) console.log('   seeded.insights=',JSON.stringify(a.state.insights),
     '\n   page.insights  =',JSON.stringify(await p.evaluate(()=>state.insights)),
     '\n   page.blockId   =',JSON.stringify(await p.evaluate(()=>state.setup&&state.setup.blockId)));
   const m=await p.evaluate(()=>({modal:!!document.getElementById('modal-overlay'),
     title:(document.querySelector('.modal-head h2')||{}).textContent||null,
     paras:[...document.querySelectorAll('.ci-para')].length,
     paraText:[...document.querySelectorAll('.ci-para')].map(n=>n.textContent).join(' '),
     cardTitle:(document.querySelector('.day-title')||{}).textContent||null,
     xo:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}));
   if(!sc.noModal && !m.modal) errs.push('no insight modal opened — this frame proves nothing');
   if(sc.noModal && m.modal) errs.push('a modal opened over the card frame');
   if(EXPECT_TITLE[sc.tag] && !EXPECT_TITLE[sc.tag].test(m.title||''))
     errs.push('photographed '+JSON.stringify(m.title)+' instead of '+sc.tag);
   /* All three phase cards share a title, so the title alone cannot tell them
      apart -- the body has to name the phase it is introducing. */
   if(sc.tag.indexOf('phase-')===0){
     const ph=sc.tag.slice(6); const body=(m.paraText||'').toLowerCase();
     if(body.indexOf(ph)<0) errs.push('the '+ph+' card never mentions '+ph);
   }
   await p.screenshot({path:path.join(OUT,sc.tag+'-'+theme+'.png'),fullPage:true});
   /* AND THE CARD ON ITS OWN. A full-page frame proves the insight sits in
      the real view; a modal-only frame is the one you can actually read the
      copy in. Both, rather than choosing. */
   if(m.modal){
     const card=await p.$('.modal-card');
     if(card) await card.screenshot({path:path.join(OUT,sc.tag+'-'+theme+'-card.png')});
   }
   console.log((sc.tag+'-'+theme).padEnd(26)+' modal='+m.modal+' paras='+m.paras+
     ' title='+JSON.stringify(m.title)+(m.cardTitle?' card='+JSON.stringify(m.cardTitle.trim()):'')+
     ' xoverflow='+(m.xo?'YES':'no')+(errs.length?'  ERRORS: '+errs[0]:''));
   await p.close(); await ctx.close();
 }}
 await br.close(); srv.close();
});
