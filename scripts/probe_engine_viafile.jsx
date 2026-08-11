#targetengine "estimer_g2_viafile"
// probe_engine_viafile.jsx — does COM DoJavaScriptFile honor #targetengine?
// Writes its findings to a log file (COM DoJavaScriptFile does not transport
// the script's completion value). If the loader honors the directive,
// $.engineName should read 'estimer_g2_viafile' and firstReadUs should be the
// fresh engine's init µs (small), NOT a continuing main-engine delta.
(function(){
  var r={engineName:String($.engineName), firstReadUs:Number($.hiresTimer), secondReadUs:Number($.hiresTimer), thirdReadUs:Number($.hiresTimer), nowIso:String(new Date())};
  var f=new File("C:/Users/SLOOSH~1/AppData/Local/Temp/opencode/estimer_viafile.json");
  f.open("w");
  f.writeln('{"engineName":"'+r.engineName+'","firstReadUs":'+r.firstReadUs+',"secondReadUs":'+r.secondReadUs+',"thirdReadUs":'+r.thirdReadUs+',"nowIso":"'+r.nowIso+'"}');
  f.close();
})()
