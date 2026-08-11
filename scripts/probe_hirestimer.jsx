#target illustrator
// probe_hirestimer.jsx — raw-engine $.hiresTimer probe (hirestimer-research-plan G1-G8)
// ESTIMER evidence deliverable. Runs in the CURRENT engine/thread (main engine).
// Measures, in ONE pass: G1 first-read magnitude, G4 raw counter position,
// G6 read overhead (n=250), G5 monotonicity (10k consecutive reads),
// G3 $.sleep inclusion, G8 accuracy ratio vs Date over 50/100/250/500 ms sleeps.
// Returns a JSON string (self-contained ES3 serializer — no JSON dependency).
// Engine-locality probes (G2/G7) are separate files: probe_engine_fresh.jsx,
// probe_engine_reuse.jsx, probe_engine_second.jsx, probe_scriptui_callback.jsx.
(function(){
  function has(a,o){for(var i=0;i<a.length;i++){if(a[i]===o)return true;}return false;}
  function S(v,seen,d){
    var t=typeof v;
    if(v===null||v===undefined)return'null';
    if(t==='string'){var e=v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t');return'"'+e+'"';}
    if(t==='number')return isNaN(v)?'null':String(v);
    if(t==='boolean')return v?'true':'false';
    if(t==='function')return'{"__t":"fn"}';
    try{if(typeof v.length!=='undefined'&&typeof v.join==='function'){if(has(seen,v))return'[]';seen.push(v);var a=[];for(var i=0;i<v.length;i++){try{a.push(S(v[i],seen,d+1))}catch(e){a.push('null')}}seen.pop();return'['+a.join(',')+']';}}catch(e){}
    if(has(seen,v))return'{"__":"r"}';seen.push(v);var p=[];
    try{for(var k in v){if(k==='parent')continue;try{var w=v[k];var wt=typeof w;if(wt==='function')continue;if(wt==='object'&&w!==null&&has(seen,w))continue;if(d>4)continue;p.push(S(k,seen,d+1)+':'+S(w,seen,d+1))}catch(e){}}}catch(e){}
    seen.pop();return'{'+p.join(',')+'}';
  }
  function safe(fn,f){try{return fn()}catch(e){return f}}
  function median(a){var n=a.length;if(n===0)return null;var s=a.slice(0).sort(function(x,y){return x-y});if(n%2===1)return s[(n-1)/2];return (s[n/2-1]+s[n/2])/2;}
  function pct(a,p){var n=a.length;if(n===0)return null;var s=a.slice(0).sort(function(x,y){return x-y});return s[Math.min(n-1,Math.floor(p*(n-1)))];}
  function mean(a){var n=a.length;if(n===0)return null;var t=0;for(var i=0;i<n;i++){t+=a[i];}return t/n;}

  var r={ok:true,
    host:{
      probe:'probe_hirestimer.jsx',
      appVersion:safe(function(){return String(app.version)},null),
      appBuild:safe(function(){return String(app.buildNumber)},null),
      engineName:safe(function(){return String($.engineName)},null),
      engineVersion:safe(function(){return String($.version)},null),
      engineBuild:safe(function(){return String($.build)},null),
      os:safe(function(){return String($.os)},null),
      locale:safe(function(){return String($.locale)},null),
      nowIso:safe(function(){return String(new Date())},null),
      nowMs:safe(function(){return new Date().getTime()},null)
    },
    probes:{}
  };

  // ---- G1: first-ever read magnitude (this engine/thread)
  var g1={};
  g1.firstReadUs=$.hiresTimer;      // first access — Adobe docs: engine/thread startup µs
  g1.secondReadUs=$.hiresTimer;     // delta since first (≈ read overhead)
  g1.thirdReadUs=$.hiresTimer;      // delta since second
  r.probes.g1=g1;

  // ---- G4 (part 1): raw counter position from the first-read magnitude,
  //      interpreted by the HOST (needs process uptime — not in-engine).
  //      See probe_g4_longdelta.jsx for the delta-across-wrap live test.

  // ---- G6: read overhead — prime, then n=250 consecutive reads; each read
  //      returns the elapsed µs since the previous access.
  var ov=[];var x=$.hiresTimer;
  for(var i=0;i<250;i++){x=$.hiresTimer;ov.push(x);}
  r.probes.g6_readOverhead={
    n:ov.length,
    medianUs:median(ov),
    meanUs:mean(ov),
    minUs:pct(ov,0.0),
    p10Us:pct(ov,0.1),
    p50Us:pct(ov,0.5),
    p90Us:pct(ov,0.9),
    p99Us:pct(ov,0.99),
    maxUs:pct(ov,1.0)
  };

  // ---- G5: monotonicity — 10k consecutive reads in one tight loop.
  //      Delta clock: every read must be > 0 (a negative/zero delta would be a
  //      counter regression or wrap-corruption; a huge delta = long stall).
  var mono={neg:0,zero:0,pos:0,nonIncrease:0,minUs:1e12,maxUs:-1e12,negSamples:[],hugeSamples:[]};
  var prev=$.hiresTimer;
  for(var mi=0;mi<10000;mi++){
    var cur=$.hiresTimer;
    if(cur<0){mono.neg++;if(mono.negSamples.length<5)mono.negSamples.push({i:mi,v:cur});}
    else if(cur===0){mono.zero++;}
    else{mono.pos++;}
    if(cur<=0){mono.nonIncrease++;}
    if(cur>1000000){mono.hugeSamples.push({i:mi,v:cur});}
    if(cur<mono.minUs)mono.minUs=cur;
    if(cur>mono.maxUs)mono.maxUs=cur;
    prev=cur;
  }
  r.probes.g5_monotonicity={
    n:10000,
    negative:mono.neg,
    zero:mono.zero,
    positive:mono.pos,
    nonIncrease:mono.nonIncrease,
    minUs:mono.minUs,
    maxUs:mono.maxUs,
    negSamples:mono.negSamples,
    hugeSamples:mono.hugeSamples
  };

  // ---- G3: does elapsed time include $.sleep (host blocking)?
  var s0=$.hiresTimer;
  var d0=new Date().getTime();
  $.sleep(200);
  var s1=$.hiresTimer;
  var d1=new Date().getTime();
  var s2=$.hiresTimer; // follow-up delta (should be tiny — clock did not jump)
  r.probes.g3_sleepInclusion={
    sleepMs:200,
    hiresDeltaUs:s1,
    dateDeltaMs:(d1-d0),
    followUpDeltaUs:s2
  };

  // ---- G8: accuracy ratio vs Date wall clock over $.sleep 50/100/250/500 ms
  var acc=[];
  var durations=[50,100,250,500];
  for(var di=0;di<durations.length;di++){
    var ms=durations[di];
    var a0=$.hiresTimer;var w0=new Date().getTime();
    $.sleep(ms);
    var a1=$.hiresTimer;var w1=new Date().getTime();
    var hUs=a1;var wMs=(w1-w0);
    acc.push({sleepMs:ms,hiresUs:hUs,dateMs:wMs,ratio:(wMs>0)?(hUs/(wMs*1000)):null});
  }
  r.probes.g8_accuracy=acc;

  // ---- G4 (part 2): spaced reads — 3 reads with 500 ms sleeps to confirm
  //      delta correctness over repeated modest intervals (see longdelta probe
  //      for the multi-minute span).
  var spaced=[];
  for(var si=0;si<3;si++){
    var t0=$.hiresTimer;
    $.sleep(500);
    var t1=$.hiresTimer;
    spaced.push({sleepMs:500,hiresDeltaUs:t1});
  }
  r.probes.g4_spacedReads=spaced;

  return S(r,[],0);
})()
