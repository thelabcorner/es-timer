#targetengine "estimer_g2_fresh"
// probe_engine_reuse.jsx — G2/G7: read in the SAME named engine a second time
// (separate COM invocation, engine persisted since probe_engine_fresh.jsx).
// If the timer is per-thread and the engine thread persists, the first read
// here is a small DELTA (elapsed since the previous probe's last read), not a
// fresh startup value. Run AFTER probe_engine_fresh.jsx.
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
    host:{probe:'probe_engine_reuse.jsx',engineName:safe(function(){return String($.engineName)},null),nowIso:safe(function(){return String(new Date())},null)},
    context:{engine:'estimer_g2_fresh (REUSED — second invocation)'},
    firstReadUs:$.hiresTimer,
    secondReadUs:$.hiresTimer,
    thirdReadUs:$.hiresTimer
  };
  return S(r,[],0);
})()
