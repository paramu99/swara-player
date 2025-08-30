// Stable version with gamakas
// Dictionary of gamakas
var gamakas = {
  "~": "kampita",
  "/": "nokku",
  ">": "jaaru",
  "^": "accentUp",
  "<": "slideLeft",
  "-": "slideDown"
};
// -----------------------------
// 🎵 Raga definitions
// -----------------------------
var ragas = {
  mayamalavagowla: {
    name: "Mayamalavagowla",
    swaras: ["S", "r", "G", "m", "P", "d", "N"]
  },
  shankarabharanam: {
    name: "Shankarabharanam",
    swaras: ["S", "R", "G", "m", "P", "D", "N"]
  },
  kharaharapriya: {
    name: "Kharaharapriya",
    swaras: ["S", "R", "g", "m", "P", "D", "n"]
  },
  todi: {
    name: "Todi",
    swaras: ["S", "r", "g", "m", "P", "d", "n"]
  },
  bhairavi: {
    name: "Bhairavi",
    swaras: ["S", "R", "g", "m", "P", "d", "n"]
  },
  kalyani: {
    name: "Kalyani",
    swaras: ["S", "R", "G", "M", "P", "D", "N"]
  },
  kapi: {
    name: "Kapi",
    swaras: ["S", "R", "g", "m", "P", "D", "n", "N"] // vakra allowance
  },
  desh: {
    name: "Desh",
    swaras: ["S", "R", "G", "m", "P", "D", "n", "N"] // vakra allowance
  }
};

// current raga (default)
var currentRaga = "mayamalavagowla";

// robust raga select init (handles either id variation)
document.addEventListener("DOMContentLoaded", function () {
  var ragaSelect = document.getElementById("ragaSelect") || document.getElementById("raga-select");
  if (ragaSelect) {
    if (!ragaSelect.value) ragaSelect.value = currentRaga;
    currentRaga = ragaSelect.value;
    ragaSelect.addEventListener("change", function () {
      currentRaga = this.value;
    });
  }
});

function getSelectedRagaKey(){
  var sel = document.getElementById("raga-select") || document.getElementById("ragaSelect");
  return sel && sel.value ? sel.value : currentRaga || "mayamalavagowla";
}

// ===== Utility: Western notes and tuning =====
var WEST_NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function clamp(v, min, max){ v = Number(v); if(!Number.isFinite(v)) return min; if(v < min) return min; if(v > max) return max; return v; }
function safeNumber(v, fallback){ v = Number(v); return Number.isFinite(v) ? v : fallback; }
function isFiniteNumber(v){ return typeof v === 'number' && Number.isFinite(v); }

function midiFromNoteName(name, octave){
  var nIndex = WEST_NOTES.indexOf(String(name || "").toUpperCase());
  var oct = safeNumber(octave, 4);
  if(nIndex < 0){ return 60; } // fallback to C4
  return (oct + 1)*12 + nIndex; // MIDI formula
}
function freqFromMidi(m){
  if(!isFiniteNumber(m)) return NaN;
  return 440 * Math.pow(2, (m - 69)/12);
}
function noteNameFromMidi(m){
  var n = ((m % 12)+12)%12;
  var oct = Math.floor(m/12) - 1;
  return WEST_NOTES[n]+oct;
}

// ===== Swara mapping (relative semitones from Sa) =====
var SWARA_MAP = {
  "S": 0,
  "r": 1, // komal Re
  "R": 2, // shuddha Re
  "g": 3, // komal Ga
  "G": 4, // shuddha Ga
  "m": 5, // shuddha Ma
  "M": 6, // tivra Ma
  "P": 7,
  "d": 8, // komal Dha
  "D": 9, // shuddha Dha
  "n": 10, // komal Ni
  "N": 11  // shuddha Ni
};

// ----------------- Tokenizer (used by parseSequence + showParsed) -----------------
function tokenizeForParse(text){
  if(!text) return [];
  var s = text.replace(/\n/g,' ').trim();
  var tokens = [];
  var i = 0;
  while(i < s.length){
    var ch = s[i];
    if(/\s/.test(ch)){ i++; continue; }        // whitespace
    if(ch === '|'){ tokens.push('|'); i++; continue; } // phrase separator
    if(ch === '('){                            // parenthesis group
      var j = i + 1;
      var depth = 1;
      while(j < s.length && depth > 0){
        if(s[j] === '(') depth++;
        else if(s[j] === ')') depth--;
        if(depth > 0) j++;
      }
      var inner = s.slice(i+1, (j < s.length ? j : s.length));
      var k = (j < s.length ? j+1 : j);
      var durMatch = s.slice(k).match(/^([0-9]{1,2})/);
      var dur = '';
      if(durMatch){ dur = durMatch[1]; k += dur.length; }
      var repMatch = s.slice(k).match(/^x([0-9]{1,3})/i);
      var rep = '';
      if(repMatch){ rep = 'x' + repMatch[1]; k += repMatch[0].length; }
      var token = '(' + inner + ')' + dur + rep;
      tokens.push(token);
      i = k;
      continue;
    }
    if(ch === '_'){                            // rest token
      var j2 = i+1; var digits = '';
      while(j2 < s.length && /[0-9]/.test(s[j2])){ digits += s[j2]; j2++; }
      tokens.push('_' + digits);
      i = j2;
      continue;
    }
    // other runs (letters, octave marks, digits, attached xN) until whitespace or | or ()
    var j3 = i; var tok = '';
    while(j3 < s.length && !/\s|\(|\)|\|/.test(s[j3])){
      tok += s[j3];
      j3++;
    }
    tokens.push(tok);
    i = j3;
  }
  return tokens;
}

// ----------------- parseSequence (raga-aware, gamaka-capable) -----------------
function parseSequence(text, selectedRagaKey){
  // Returns array of {token, isRest, base, offset, octaveShift, beats, gamaka?, error?, inRaga?, outOfRaga?}
  var out = [];
  if(!text){ return out; }

  // accept M# historically but normalize
  function normalizeM(s){ return String(s || "").replace(/M#/g,'M'); }

  var BASE_RE = /^(S|r|R|g|G|m|M|P|d|D|n|N)/;

  // fetch raga definition
  var raga = ragas[selectedRagaKey];
  var allowedSwaras = raga ? raga.swaras : [];

  // build a quick lookup for in-raga checks
  var allowedSet = null;
  if(allowedSwaras && allowedSwaras.length){
    allowedSet = Object.create(null);
    for(var ai=0; ai<allowedSwaras.length; ai++){ allowedSet[allowedSwaras[ai]] = true; }
  }

  function cloneNote(n){
    return {
      token: n.token,
      isRest: !!n.isRest,
      base: n.base,
      offset: n.offset,
      octaveShift: n.octaveShift,
      beats: n.beats,
      gamaka: n.gamaka,
      error: n.error,
      inRaga: !!n.inRaga,
      outOfRaga: !!n.outOfRaga
    };
  }

  function makeErrorToken(orig, msg){
    return { token: orig, error: msg, inRaga: false, outOfRaga: false };
  }

  function annotateRagaFields(note){
    if(!note || note.error || note.isRest){ return note; }
    var isInRaga = allowedSet ? !!allowedSet[note.base] : false;
    note.inRaga = isInRaga;
    note.outOfRaga = !isInRaga;
    return note;
  }

  // helper: check for single-char gamaka symbol
  var GAMAKA_RE = /^[~\/\^<>\-]$/;

  function parseSingleTokenStr(tok){
    var s = normalizeM(tok);
    var mBase = s.match(BASE_RE);
    if(!mBase){ return { error: "Unknown token" }; }
    var base = mBase[1];
    var rest = s.slice(base.length);

    // optional gamaka immediately after base
    var gamaka = null;
    if(rest.length && GAMAKA_RE.test(rest[0])){
      gamaka = rest[0];
      rest = rest.slice(1);
    }

    // count octave up (') then octave down (.) in order
    var upCount = 0;
    var i = 0;
    while(i < rest.length && rest[i] === "'"){ upCount++; i++; }
    var downCount = 0;
    while(i < rest.length && rest[i] === '.'){ downCount++; i++; }

    // remaining part may contain accidentals (#, b) and duration digits at end
    var trailing = rest.slice(i);
    var accidentalShift = 0;
    if(trailing.indexOf('#') >= 0) accidentalShift = 1;
    else if(trailing.indexOf('b') >= 0) accidentalShift = -1;

    var mBeats = trailing.match(/([0-9]{1,2})$/);
    var beats = 1;
    if(mBeats){ beats = parseInt(mBeats[1],10); if(!Number.isFinite(beats) || beats < 0) beats = 1; }

    var baseOffset = SWARA_MAP[base];
    if(typeof baseOffset === 'undefined'){ return { error: "Unsupported swara" }; }
    var offset = baseOffset + accidentalShift;

    var tokenOut = base + (gamaka ? gamaka : "") + (upCount ? "'".repeat(upCount) : "") + (downCount ? ".".repeat(downCount) : "");
    return annotateRagaFields({ token: tokenOut, isRest: false, base: base, gamaka: gamaka, offset: offset, octaveShift: upCount - downCount, beats: beats });
  }

  function parseRunString(runStr){
    var s = normalizeM(runStr);
    var items = [];
    var p = 0;
    while(p < s.length){
      var substr = s.slice(p);
      var mBase = substr.match(BASE_RE);
      if(!mBase){ return { error: "Unknown run content" }; }
      var base = mBase[1];
      p += base.length;

      // optional gamaka
      var gamaka = null;
      if(p < s.length && GAMAKA_RE.test(s[p])){
        gamaka = s[p];
        p++;
      }

      // optional octave marks immediately after
      var upCount = 0;
      while(p < s.length && s[p] === "'"){ upCount++; p++; }
      var downCount = 0;
      while(p < s.length && s[p] === '.'){ downCount++; p++; }

      // optional accidental attached inside run (rare) -> check next chars but don't consume trailing digits here
      var accidentalShift = 0;
      if(p < s.length && s[p] === '#'){ accidentalShift = 1; p++; }
      else if(p < s.length && s[p] === 'b'){ accidentalShift = -1; p++; }

      var tokenForm = base + (gamaka ? gamaka : "") + (upCount ? "'".repeat(upCount) : "") + (downCount ? ".".repeat(downCount) : "");
      var baseOffset = SWARA_MAP[base];
      if(typeof baseOffset === 'undefined'){ return { error: "Unsupported swara in run" }; }
      items.push(annotateRagaFields({ token: tokenForm, isRest:false, base: base, gamaka: gamaka, offset: baseOffset + accidentalShift, octaveShift: upCount - downCount, beats: 1 }));
    }
    return { items: items };
  }

  // small helper to replicate chunks
  function replicate(outArr, startIndex, count, times){
    if(times <= 1 || count <= 0) return;
    var chunk = outArr.slice(startIndex, startIndex + count);
    for(var r=1; r<times; r++){
      for(var k=0; k<chunk.length; k++){
        outArr.push(cloneNote(chunk[k]));
      }
    }
  }

  var tokens = tokenizeForParse(text);

  var phraseStartIndex = 0;
  var lastGroupStart = 0;
  var lastGroupCount = 0;

  for(var i=0;i<tokens.length;i++){
    var rawTok = tokens[i];
    if(!rawTok) continue;

    var t = normalizeM(rawTok); // normalize "M#"

    if(t === "|"){ phraseStartIndex = out.length; continue; }

    // rest (underscore with optional beats)
    if(/^_/.test(t)){
      var mRest = t.match(/^_([0-9]{0,2})$/);
      var beatsRest = 1;
      if(mRest && mRest[1]){ beatsRest = parseInt(mRest[1],10); }
      if(!Number.isFinite(beatsRest) || beatsRest < 0){ beatsRest = 1; }
      out.push({ token: "_", isRest: true, base: null, offset: null, octaveShift: 0, beats: beatsRest, inRaga: false, outOfRaga: false });
      lastGroupStart = out.length - 1;
      lastGroupCount = 1;
      continue;
    }

    // separate repetition token like "x3"
    var separateRep = t.match(/^x([0-9]+)$/i);
    if(separateRep){
      var rpt = parseInt(separateRep[1],10) || 1;
      if(rpt > 1){
        var phraseChunk = out.slice(phraseStartIndex);
        if(phraseChunk.length > 0){
          replicate(out, phraseStartIndex, phraseChunk.length, rpt);
          lastGroupStart = out.length - phraseChunk.length;
          lastGroupCount = phraseChunk.length;
        }
      }
      continue;
    }

    // attached repetition like "(SRG)x2" or "SRGx3"
    var repAttached = null;
    var mRepAttached = t.match(/^(.*)x([0-9]{1,3})$/i);
    if(mRepAttached){
      t = mRepAttached[1];
      repAttached = parseInt(mRepAttached[2],10) || 1;
    }

    // parenthesis group "(...)" with optional group duration and attached rep handled above
    var mParen = t.match(/^\(([\s\S]*)\)([0-9]{1,2})?$/);
    if(mParen){
      var inner = (mParen[1] || "").trim();
      var groupBeats = mParen[2] ? parseInt(mParen[2],10) : 1;
      if(!Number.isFinite(groupBeats) || groupBeats <= 0) groupBeats = 1;

      var parsedItems = null;

      if(/\s+/.test(inner)){
        var innerParts = inner.split(/\s+/);
        parsedItems = [];
        var bad = false;
        for(var j=0;j<innerParts.length;j++){
          var sTok = innerParts[j];
          var pRes = parseSingleTokenStr(sTok);
          if(pRes.error){ bad = true; break; }
          parsedItems.push(pRes);
        }
        if(bad){
          out.push(makeErrorToken(rawTok, "Unknown token inside group"));
          lastGroupStart = out.length - 1; lastGroupCount = 1;
          continue;
        }
      } else {
        var runRes = parseRunString(inner);
        if(runRes.error){
          out.push(makeErrorToken(rawTok, runRes.error));
          lastGroupStart = out.length - 1; lastGroupCount = 1;
        } else {
          parsedItems = runRes.items;
        }
        if(!parsedItems) continue;
      }

      var per = groupBeats / parsedItems.length;
      var startIndex = out.length;
      for(var k=0;k<parsedItems.length;k++){
        var note = parsedItems[k];
        note.beats = per;
        out.push(note);
      }
      lastGroupStart = startIndex;
      lastGroupCount = parsedItems.length;

      if(repAttached && repAttached > 1 && lastGroupCount > 0){
        replicate(out, lastGroupStart, lastGroupCount, repAttached);
        lastGroupStart = out.length - (lastGroupCount * repAttached);
        lastGroupCount = lastGroupCount * repAttached;
      }
      continue;
    }

    // run or single (e.g., "S2", "G'", "SRGM2")
    var mDur = t.match(/([0-9]{1,2})$/);
    var groupDuration = mDur ? parseInt(mDur[1],10) : 1;
    if(!Number.isFinite(groupDuration) || groupDuration <= 0) groupDuration = 1;
    var mainStr = mDur ? t.slice(0, -String(mDur[1]).length) : t;
    if(!mainStr){
      out.push(makeErrorToken(rawTok, "Empty token"));
      lastGroupStart = out.length - 1; lastGroupCount = 1;
      continue;
    }

    var runRes2 = parseRunString(mainStr);
    if(runRes2.error){
      out.push(makeErrorToken(rawTok, runRes2.error));
      lastGroupStart = out.length - 1; lastGroupCount = 1;
      continue;
    }

    var start = out.length;
    for (var u=0; u<runRes2.items.length; u++) {
      var it2 = runRes2.items[u];
      it2.beats = groupDuration; // each swara gets full duration for plain runs
      out.push(it2);
    }

    lastGroupStart = start;
    lastGroupCount = runRes2.items.length;

    if(repAttached && repAttached > 1 && lastGroupCount > 0){
      replicate(out, lastGroupStart, lastGroupCount, repAttached);
      lastGroupStart = out.length - (lastGroupCount * repAttached);
      lastGroupCount = lastGroupCount * repAttached;
    }
  }

  // ensure raga annotations are present for all items (for runs that may have not been annotated)
  for(var ii=0; ii<out.length; ii++){
    if(!out[ii].hasOwnProperty('inRaga')){
      annotateRagaFields(out[ii]);
    }
  }

  return out;
}

// Helper: convert parsed swaras into midi/freq events (skipping errors/rests)
function toMidiEvents(parsed, saMidi){
  var events = [];
  for(var i=0;i<parsed.length;i++){
    var item = parsed[i];
    if(!item || item.isRest || item.error){ continue; }
    // ensure offset numeric
    var off = item.offset;
    if(!isFiniteNumber(off)){ continue; }
    var midi = saMidi + off + (item.octaveShift*12);
    var freq = freqFromMidi(midi);
    if(!isFiniteNumber(midi) || !isFiniteNumber(freq)){ continue; }
    events.push({ token:item.token, midi:midi, freq:freq, beats: item.beats || 1, gamaka: item.gamaka || null });
  }
  return events;
}

// ===== Scheduling / Audio =====
var audioCtx = null;
var currentNodes = [];
function ensureCtx(){
  if(!audioCtx){ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
}
function stopAll(){
  for(var i=0;i<currentNodes.length;i++){
    try{ currentNodes[i].stop(); }catch(e){}
    try{ currentNodes[i].disconnect && currentNodes[i].disconnect(); }catch(e){}
  }
  currentNodes = [];
}

function schedulePlay(parsed, saMidi, bpm, wave, attack, rel, gainLevel){
  ensureCtx();
  stopAll();

  // ---- sanitize numbers ----
  bpm = clamp(safeNumber(bpm, 96), 30, 240);
  var beatSec = 60 / bpm;
  var minDur = 0.03; // safety for extremely short durations
  var a = clamp(safeNumber(attack, 0.02), 0, 1);
  var r = clamp(safeNumber(rel, 0.12), 0, 2);
  var g = clamp(safeNumber(gainLevel, 0.25), 0, 1);

  var baseTime = audioCtx.currentTime + 0.06; // slight delay for scheduling
  if(audioCtx.state === 'suspended'){ try{ audioCtx.resume(); }catch(e){} }

  var t = baseTime;
  for(var i=0;i<parsed.length;i++){
    var item = parsed[i];
    var beats = (item && Number.isFinite(item.beats)) ? item.beats : 1;
    var dur = Math.max(minDur, beats * beatSec);

    if(!item || item.error){ t += dur; continue; }
    if(item.isRest){ t += dur; continue; }

    var off = item.offset;
    if(!isFiniteNumber(off)){ t += dur; continue; }
    var midi = saMidi + off + (item.octaveShift*12);
    var freq = freqFromMidi(midi);
    if(!isFiniteNumber(freq)){ t += dur; continue; } // skip bad tokens safely

    var osc = audioCtx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);

// 🎶 Apply gamakas
switch(item.gamaka){
  case "~": // kampita vibrato
    var depth = freq * Math.pow(2, 30/1200) - freq; // ~30 cents
    var vibRate = 6; // Hz
    for(var k=0; k<dur*20; k++){
      var tt = t + k*(1/vibRate/2);
      var fval = freq + (k%2===0 ? depth : -depth);
      osc.frequency.linearRampToValueAtTime(fval, tt);
    }
    osc.frequency.linearRampToValueAtTime(freq, t+dur);
    break;

  case "/": // nokku (grace above)
    osc.frequency.setValueAtTime(freq*1.06, t); // 1 semitone above
    osc.frequency.linearRampToValueAtTime(freq, t+0.15);
    break;

  case ">": // jaru up (slide into pitch)
    osc.frequency.setValueAtTime(freq/Math.pow(2,1/12), t); // start semitone below
    osc.frequency.linearRampToValueAtTime(freq, t+0.25);
    break;

  case "-": // jaru down (slide down)
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.linearRampToValueAtTime(freq/Math.pow(2,1/12), t+dur*0.8);
    break;

  case "^": // upward accent flick
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.linearRampToValueAtTime(freq*1.08, t+0.1);
    osc.frequency.linearRampToValueAtTime(freq, t+0.2);
    break;

  case "<": // slow glide down
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.linearRampToValueAtTime(freq/Math.pow(2,3/12), t+dur);
    break;
}


    var amp = audioCtx.createGain();
    var start = t;
    var end = t + dur;

    // Envelope safety: ensure times are strictly increasing
    var attackEnd = start + Math.max(0.005, a);
    var releaseStart = Math.max(start + 0.01, end - Math.max(0.01, r));

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), attackEnd);
    amp.gain.setValueAtTime(Math.max(0.0002, g), releaseStart);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(amp);
    amp.connect(audioCtx.destination);

    osc.start(start);
    osc.stop(end + 0.02);

    currentNodes.push(osc);
    t = end;
  }
}

// ===== UI wiring =====
var elSeq  = document.getElementById('seq');
var elSa   = document.getElementById('saNote');
var elOct  = document.getElementById('saOct');
var elBpm  = document.getElementById('bpm');
var elWave = document.getElementById('wave');
var elA    = document.getElementById('attack');
var elR    = document.getElementById('release');
var elG    = document.getElementById('gain');
var elLog  = document.getElementById('log');
var elStatus = document.getElementById('status');

function setStatus(text){ elStatus.textContent = text; }

// Single, raga-aware showParsed
function showParsed(){
  var ragaKey = getSelectedRagaKey();
  var parsed = parseSequence(elSeq.value, ragaKey);
  var saMidi = midiFromNoteName(elSa.value, parseInt(elOct.value,10));
  var lines = [];
  var toks = tokenizeForParse(elSeq.value);
  lines.push("TOKENS: " + (toks.length ? toks.join("  |  ") : "(none)"));
  lines.push("");
  for(var i=0;i<parsed.length;i++){
    var it = parsed[i];
    if(it.error){ lines.push("? \t" + it.token + " \t→ ERROR: " + it.error); continue; }
    if(it.isRest){ lines.push("_ \t(rest) \tbeats=" + (it.beats||1)); continue; }
    if(!isFiniteNumber(it.offset)){ lines.push(it.token + "\t→ (skipped: bad offset)"); continue; }
    var midi = saMidi + it.offset + (it.octaveShift*12);
    var freq = freqFromMidi(midi);
    if(!isFiniteNumber(freq)){ lines.push(it.token + "\t→ (skipped: bad number)"); continue; }
    var name = noteNameFromMidi(midi);
    // purely textual—no highlighting by design
    var tag = (it.outOfRaga ? " [out]" : "");
    var g = it.gamaka ? " {" + (gamakas[it.gamaka] || it.gamaka) + "}" : "";
    lines.push(it.token + g + " \t→ " + name + " ("+freq.toFixed(2)+" Hz)\tbeats="+(it.beats||1)+tag);
  }
  elLog.textContent = lines.join("\n");
}

function copyWestern(){
  var ragaKey = getSelectedRagaKey();
  var parsed = parseSequence(elSeq.value, ragaKey);
  var saMidi = midiFromNoteName(elSa.value, parseInt(elOct.value,10));
  var names = [];
  for(var i=0;i<parsed.length;i++){
    var it = parsed[i];
    if(it.isRest){ names.push("rest"+(it.beats>1?"("+it.beats+")":"")); continue; }
    if(it.error){ names.push("?"); continue; }
    if(!isFiniteNumber(it.offset)){ continue; }
    var midi = saMidi + it.offset + (it.octaveShift*12);
    if(!isFiniteNumber(midi)){ continue; }
    names.push(noteNameFromMidi(midi) + (it.beats>1?"("+it.beats+")":""));
  }
  var txt = names.join(" ");
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ setStatus("Copied Western notes"); }, function(){ setStatus("Clipboard blocked by browser"); });
  } else {
    setStatus("Clipboard API unavailable");
  }
}

function sanitizeInputsFromUI(){
  var oct = parseInt(elOct.value,10);
  var saMidi = midiFromNoteName(elSa.value, oct);
  var bpm = clamp(safeNumber(elBpm.value, 96), 30, 240);
  var wave = elWave.value;
  var a = clamp(safeNumber(elA.value, 0.02), 0, 1);
  var r = clamp(safeNumber(elR.value, 0.12), 0, 2);
  var g = clamp(safeNumber(elG.value, 0.25), 0, 1);

  // Reflect sanitized values back to inputs (prevents NaN from user clears)
  elBpm.value = bpm; elA.value = a; elR.value = r; elG.value = g;

  return { saMidi: saMidi, bpm: bpm, wave: wave, a: a, r: r, g: g };
}

function play(){
  var ragaKey = getSelectedRagaKey();
  var parsed = parseSequence(elSeq.value, ragaKey);
  if(!parsed.length){ setStatus("Nothing to play"); elLog.textContent = ""; return; }

  var cfg = sanitizeInputsFromUI();
  showParsed(); // show textual parse with [out] markers (no highlighting)
  schedulePlay(parsed, cfg.saMidi, cfg.bpm, cfg.wave, cfg.a, cfg.r, cfg.g);
  setStatus("Playing");
}

function stop(){ stopAll(); setStatus("Stopped"); }
function clearAll(){ elSeq.value = ""; elLog.textContent=""; setStatus("Cleared"); }

// Demo examples
function setupExamples(){
  var e1 = document.getElementById('ex1');
  var e2 = document.getElementById('ex2');
  var e3 = document.getElementById('ex3');
  if(e1) e1.onclick = function(){ elSeq.value = "S R G P D S' | S' D P G R S"; showParsed(); };
  if(e2) e2.onclick = function(){ elSeq.value = "S r g M P d n S' | S' n d P M g r S"; showParsed(); };
  if(e3) e3.onclick = function(){ elSeq.value = "S2 R G G M2 P _ R2 G M P2"; showParsed(); };
}

// ===== Simple tests =====
function runTests(){
  var results = [];
  function pass(name){ results.push("✅ "+name); }
  function fail(name, msg){ results.push("❌ "+name+ (msg?" — "+msg:"")); }

  try{
    var ragaKey = "shankarabharanam";

    // T1: Basic parse → midi events are finite
    var seq1 = "S R G m P D N S'";
    var p1 = parseSequence(seq1, ragaKey);
    var events1 = toMidiEvents(p1, midiFromNoteName('C',4));
    var allFinite = events1.every(function(e){ return isFiniteNumber(e.midi) && isFiniteNumber(e.freq); });
    allFinite ? pass("T1 midi/freq finite for basic scale") : fail("T1", "non-finite values");

    // T2: Unknown tokens should be skipped, not crash
    var seq2 = "S X Y Z | R";
    var p2 = parseSequence(seq2, ragaKey);
    var events2 = toMidiEvents(p2, midiFromNoteName('C',4));
    (events2.length === 2) ? pass("T2 unknown tokens skipped") : fail("T2", "expected 2 playable tokens");

    // T3: BPM=0 or blank → sanitized to within [30,240]
    var oldBpm = elBpm.value; elBpm.value = "";
    var cfg3 = sanitizeInputsFromUI();
    (cfg3.bpm >= 30 && cfg3.bpm <= 240) ? pass("T3 bpm sanitized when blank") : fail("T3", "bpm not sanitized");
    elBpm.value = 0; var cfg3b = sanitizeInputsFromUI();
    (cfg3b.bpm >= 30) ? pass("T3b bpm sanitized when 0") : fail("T3b", "bpm not clamped");
    elBpm.value = oldBpm;

    // T4: Empty gain → default used (0.25)
    var oldGain = elG.value; elG.value = ""; var cfg4 = sanitizeInputsFromUI();
    (Math.abs(cfg4.g - 0.25) < 1e-6) ? pass("T4 gain fallback when blank") : fail("T4", "gain fallback failed");
    elG.value = oldGain;

    // T5: midiFromNoteName invalid name → fallback to C4 (60)
    (midiFromNoteName('H',4) === 60) ? pass("T5 invalid note name fallback") : fail("T5", "expected MIDI 60");

    // T6: Parser with octave marks and durations produces finite events
    var seq6 = "S' R. G2 M'2 _2 P D' n. N2";
    var p6 = parseSequence(seq6, ragaKey);
    var ev6 = toMidiEvents(p6, midiFromNoteName('D',3));
    ev6.length > 0 && ev6.every(function(e){ return isFiniteNumber(e.midi) && isFiniteNumber(e.freq) })
      ? pass("T6 octave & durations finite") : fail("T6", "bad event detected");

  }catch(ex){
    fail("Tests crashed", String(ex && ex.message || ex));
  }

  elLog.textContent = results.join("\n");
  setStatus("Tests finished");
}

// Wire buttons and init
function initNotes(){
  for(var i=0;i<WEST_NOTES.length;i++){
    var op = document.createElement('option');
    op.value = WEST_NOTES[i];
    op.textContent = WEST_NOTES[i];
    if(elSa) elSa.appendChild(op);
  }
  if(elSa) elSa.value = "C";
}

initNotes();
setupExamples();
var btnPlay = document.getElementById('play');
if(btnPlay) btnPlay.onclick = play;
var btnStop = document.getElementById('stop');
if(btnStop) btnStop.onclick = stop;
var btnClear = document.getElementById('clear');
if(btnClear) btnClear.onclick = clearAll;
var btnShow = document.getElementById('showParsed');
if(btnShow) btnShow.onclick = showParsed;
var btnCopy = document.getElementById('copyWestern');
if(btnCopy) btnCopy.onclick = copyWestern;
var btnRunTests = document.getElementById('runTests');
if(btnRunTests) btnRunTests.onclick = runTests;

// Prefill demo
if(elSeq) elSeq.value = "S R G m P D N S' | S' N D P M G R S";
showParsed();
