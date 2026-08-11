#targetengine "estimer_g2_fresh"
// probe_engine_fresh.jsx — G2/G7: first read in a FRESH named engine.
// A #targetengine directive creates a persistent engine on demand; the first
// $.hiresTimer access on its thread should return its init/startup µs (small,
// since the engine was just created) — NOT the main engine's huge value.
// Run BEFORE probe_engine_reuse.jsx (same engine name).
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
    host:{probe:'probe_engine_fresh.jsx',engineName:safe(function(){return String($.engineName)},null),nowIso:safe(function(){return String(new Date())},null)},
    context:{engine:'estimer_g2_fresh (created by #targetengine for this run)'},
    firstReadUs:$.hiresTimer,
    secondReadUs:$.hiresTimer,
    thirdReadUs:$.hiresTimer
  };
  return S(r,[],0);
})()
