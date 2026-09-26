(function () {
  var g = null;
  try { if (typeof $ !== "undefined" && $.global) { g = $.global; } } catch (e1) {}
  if (!g) { try { g = (function () { return this; })(); } catch (e2) {} }
  if (!g) return;
  g.ESTIMER = ESTIMER;
})();
