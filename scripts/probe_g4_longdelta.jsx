#target illustrator
// probe_g4_longdelta.jsx — G4 live: is a delta computed CORRECTLY while the
// raw signed 32-bit counter sits past its wrap boundary?
// The main engine in this deployment has been up ~9 h (>> 35.8 min wrap), so
// the first read here should be a NEGATIVE wrapped value (raw position = 
// uptime mod 2^32, signed). If the engine computes deltas wrap-safely, a
// multi-minute $.sleep delta still returns the TRUE elapsed µs (~60 s → ~6e7).
// CAUTION: holds the COM lock for the sleep duration (~62 s).
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
  var r={ok:true,
    host:{probe:'probe_g4_longdelta.jsx',engineName:safe(function(){return String($.engineName)},null),nowIso:safe(function(){return String(new Date())},null)},
    sleepMs:60000,
    firstReadUs:$.hiresTimer,       // raw signed-32-bit position of the main-engine counter
    dateBeforeMs:new Date().getTime()
  };
  $.sleep(60000);
  r.dateAfterMs=new Date().getTime();
  r.deltaAfterSleepUs=$.hiresTimer;   // TRUE elapsed µs if delta math is wrap-safe
  r.dateDeltaMs=(r.dateAfterMs-r.dateBeforeMs);
  r.followUpDeltaUs=$.hiresTimer;     // tiny if no clock jump
  return S(r,[],0);
})()
