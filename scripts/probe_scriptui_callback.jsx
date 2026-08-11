#target illustrator
// probe_scriptui_callback.jsx — G7: does the hiresTimer state continue across
// a ScriptUI event callback (same thread as the main engine)?
// Method: prime the main thread, create a palette with a button, trigger the
// button's onClick via notify(), and compare the first read inside the callback
// against the wall-clock gap since the main-thread prime. Same-thread behavior:
// callback first read ≈ wall gap (small, ms). Fresh-thread behavior: callback
// first read would be an unrelated magnitude (startup value of a new thread).
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
  var out={ok:false};
  var primeUs=$.hiresTimer;                 // main-thread prime
  var primeDateMs=new Date().getTime();
  try{
    var w=new Window('palette','probe',undefined,{closeButton:false});
    w.orientation='column';
    var btn=w.add('button',undefined,'go');
    var captured=null;
    btn.onClick=function(){
      var a=$.hiresTimer;                   // first read inside the callback
      var b=$.hiresTimer;                   // delta after
      captured={firstReadUs:a,secondReadUs:b,wallMs:new Date().getTime()};
    };
    btn.notify('onClick');
    w.close();
    out.ok=true;
    out.callback=captured;
    out.mainThreadPrimeUs=primeUs;
    out.mainThreadDateMs=primeDateMs;
    out.wallGapMs=(captured? (captured.wallMs-primeDateMs):null);
  }catch(e){
    out.error=String(e);
  }
  out.host={probe:'probe_scriptui_callback.jsx',engineName:safe(function(){return String($.engineName)},null),nowIso:safe(function(){return String(new Date())},null)};
  return S(out,[],0);
})()
