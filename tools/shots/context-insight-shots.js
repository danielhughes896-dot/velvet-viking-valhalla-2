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
const SCENES=[
 {tag:'programme', build:()=>mk(-8)},
 {tag:'phase-build', build:()=>{const a=mk(-22);a.insightRecord(K(a),true);a.state.insights.shownOn=null;return a;}},
 {tag:'new-workout', build:()=>{const a=mk(-35);a.insightRecord(K(a),true);a.state.insights.shownOn=null;
    const d=a.state.days.filter(x=>x.date===a.addDays(T,1))[0];
    if(d){d.type='over_under';d.km=10;d.title='Over-Under: 3x(1km/1km)';
      d.desc='2km warm-up. 3 cycles of 1km under threshold straight into 1km over, continuous. 1km cool-down.';
      d.prescription={v:a.PRESCRIPTION_VERSION,archetype:'over_under',params:{cycles:3}};}
    return a;}},
 {tag:'threshold', build:()=>{const a=mk(-35);a.insightRecord(K(a),true);a.state.insights.shownOn=null;
    a.state.setup.thresholdPaceSource='calibration';a.state.setup.thresholdPaceSecPerKm=277;return a;}},
 {tag:'restriction-return', build:()=>{const a=mk(-35);a.insightRecord(K(a),true);a.state.insights.shownOn=null;
    a.declareRestriction('none',a.addDays(T,10));a.state.setup.restriction.from=a.addDays(T,-14);a.endRestriction();return a;}},
 {tag:'deuce-card', build:()=>{const a=mk(-35);
    a.state.insights.quietBlockId=a.insightBlockKey();   // no modal on this one
    const d=a.state.days.filter(x=>x.date===T)[0]||a.state.days.filter(x=>x.date>=T)[0];
    const t=a.intervalWorkoutText({sets:2,reps:4,m:400,t:'interval'},9);
    d.type='interval';d.km=9;d.title=t.title;d.desc=t.desc;
    d.prescription={v:a.PRESCRIPTION_VERSION,archetype:'deuce',params:{sets:2,reps:4,m:400}};
    return a;}, noModal:true},
];
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
     cardTitle:(document.querySelector('.day-title')||{}).textContent||null,
     xo:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}));
   if(!sc.noModal && !m.modal) errs.push('no insight modal opened — this frame proves nothing');
   if(sc.noModal && m.modal) errs.push('a modal opened over the card frame');
   await p.screenshot({path:path.join(OUT,sc.tag+'-'+theme+'.png'),fullPage:true});
   console.log((sc.tag+'-'+theme).padEnd(26)+' modal='+m.modal+' paras='+m.paras+
     ' title='+JSON.stringify(m.title)+(m.cardTitle?' card='+JSON.stringify(m.cardTitle.trim()):'')+
     ' xoverflow='+(m.xo?'YES':'no')+(errs.length?'  ERRORS: '+errs[0]:''));
   await p.close(); await ctx.close();
 }}
 await br.close(); srv.close();
});
