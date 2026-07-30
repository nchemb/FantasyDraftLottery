/* Draft Night '26 — broadcast player.
   The whole show is a deterministic timeline anchored to one epoch (showStart).
   Every viewer computes the same segment from the clock, so everyone stays in
   sync without a render server or per-pick polling. */
(function () {
  "use strict";

  var qs = new URLSearchParams(location.search);
  var REVEAL_ID = qs.get("id");
  var HOST_TOKEN = qs.get("host") || null;
  var IS_NEW = qs.get("new") === "1";
  var IS_DEMO = qs.get("demo") === "1";

  var CLIPS = {
    arena: "broadcast/t1-arena.mp4",
    stage: "broadcast/t2-stage.mp4",
    podium: "broadcast/t3-podium.mp4",
    crowdA: "broadcast/t4-crowd-a.mp4",
    crowdB: "broadcast/t5-crowd-b.mp4",
    confetti: "broadcast/t6-confetti.mp4",
  };
  // Variant pools. Selection is keyed off the pick number, never Math.random():
  // every viewer must compute the identical broadcast.
  var PODIUM_CLIPS = [
    "broadcast/t3-podium.mp4",
    "broadcast/t3-podium-b.mp4",
    "broadcast/t3-podium-c.mp4",
    "broadcast/t3-podium-d.mp4",
  ];
  var CROWD_CLIPS = [
    "broadcast/t4-crowd-a.mp4",
    "broadcast/t5-crowd-b.mp4",
    "broadcast/t7-crowd-c.mp4",
    "broadcast/t8-crowd-d.mp4",
    "broadcast/t9-crowd-e.mp4",
  ];
  // Multipliers must be coprime with pool sizes or the rotation collapses onto one clip.
  function podiumFor(pick) { return PODIUM_CLIPS[(pick * 3 + 1) % PODIUM_CLIPS.length]; }
  function crowdFor(pick) { return CROWD_CLIPS[(pick * 3 + 2) % CROWD_CLIPS.length]; }
  // Visible camera variety on the locked-off podium shots: seeded ken-burns move.
  var CAMERA_MOVES = ["cam-none", "cam-push", "cam-pull", "cam-drift"];
  function cameraFor(pick) { return CAMERA_MOVES[(pick * 3 + 1) % CAMERA_MOVES.length]; }
  // Atmosphere rotation inside pacing gaps: stage wides + crowd shots + podium.
  var ATMO_CLIPS = [
    "broadcast/t2-stage.mp4",
    "broadcast/t4-crowd-a.mp4",
    "broadcast/t3-podium.mp4",
    "broadcast/t5-crowd-b.mp4",
    "broadcast/t7-crowd-c.mp4",
    "broadcast/t3-podium-b.mp4",
    "broadcast/t8-crowd-d.mp4",
    "broadcast/t9-crowd-e.mp4",
  ];
  var BED_MUSIC_URL = "broadcast/bed-music.mp3";
  // Measured against the announcer (-13.3 dB mean) via tools/render-audio-preview.js:
  // 0.28 puts the bed ~12 dB under VO (present but light), 0.12 ~19 dB under
  // while he's talking. 0.08 measured 22.5 dB under — effectively inaudible.
  var BED_VOLUME = 0.28;
  var BED_DUCKED = 0.12;

  // Pacing (ms). Quick mode kicks in past 16 teams so a 32-team show stays sane.
  // Each segment must outlast its VO clip — VO isn't truncated at a segment
  // boundary, it bleeds into the next one and the announcer talks over himself.
  // Measured against the v3 announcer: intro 15.3s, worst-case pick 10.9s
  // (longest ordinal + 50-char team name + long league name), twoRemain 5.8s.
  var COLD_OPEN = 17000;
  var PER_PICK = 12000;
  var PER_PICK_QUICK = 11000;
  var TWO_REMAIN = 7000;
  var FINAL_PICK = 21000;
  var FINAL_VO_AT = 7500;   // silence, then the call
  var FINAL_SLAM = 14500;   // fallback cue when clip length is unknown

  var $ = function (id) { return document.getElementById(id); };

  var data = null;          // reveal payload (order arrives only once live)
  var segments = null;      // built timeline
  var totalDur = 0;
  var clockOffset = 0;      // serverNow - clientNow, so everyone shares the server clock
  var showStart = null;     // epoch ms
  var joined = false;
  var playing = false;
  var tickTimer = null;
  var pollTimer = null;
  var activeVid = null;
  var voAudio = {};         // preloaded Audio objects
  var lastSegIndex = -1;
  var confettiFired = false;

  /* ---------- Demo fixture ---------- */

  var DEMO_DATA = {
    leagueName: "The Gridiron Gang",
    revealId: "demo",
    teamCount: 6,
    sealedAt: null,
    commitmentHash: "demo",
    mode: "manual",
    live: false,
    draftOrder: [
      "Last Place Larry",
      "The Sleeper Cell",
      "Draft Day Dave",
      "The Waiver Wire Warriors",
      "Kicker Karen",
      "The Benchwarmers",
    ],
    audioManifest: {
      intro: "broadcast/demo/intro.mp3",
      twoRemain: "broadcast/demo/two-remain.mp3",
      picks: {
        1: "broadcast/demo/pick-1.mp3",
        2: "broadcast/demo/pick-2.mp3",
        3: "broadcast/demo/pick-3.mp3",
        4: "broadcast/demo/pick-4.mp3",
        5: "broadcast/demo/pick-5.mp3",
        6: "broadcast/demo/pick-6.mp3",
      },
      // Same shape finalize.js writes, so the sample is paced by the same code
      // path as a paid show. Regenerate with tools/gen-demo-vo.js --durations.
      dur: {
        intro: 15337,
        twoRemain: 5906,
        picks: { 1: 8702, 2: 6220, 3: 8702, 4: 8231, 5: 7030, 6: 7996 },
      },
    },
  };

  /* ---------- Timeline ---------- */

  // Clip lengths measured at generation time, keyed the same way as the audio.
  // Absent for chyron-only shows and for rows sealed before durations shipped,
  // in which case every lookup returns 0 and the constants below stand alone.
  function voDur(key, pick) {
    var d = (data && data.audioManifest && data.audioManifest.dur) || null;
    if (!d) return 0;
    if (key === "pick") return (d.picks && d.picks[pick]) || 0;
    return d[key] || 0;
  }

  function buildSegments(order, gapSeconds) {
    var n = order.length;
    var perPick = n > 16 ? PER_PICK_QUICK : PER_PICK;
    var gapMs = (gapSeconds || 0) * 1000;
    var segs = [];
    var t = 0;

    // A segment must outlast its own VO or the announcer talks over the next
    // pick: a 50-char team name renders ~12s against an 11s quick slot. Sizing
    // from the manifest keeps everyone in sync because every client reads the
    // same numbers off the same payload.
    function fit(base, dur, tail) {
      return dur ? Math.max(base, dur + tail) : base;
    }

    // A pacing gap = a run of ~10s atmosphere chunks, each with its own clip,
    // so late joiners land on the right shot and everyone rotates in lockstep.
    function pushGap(nextPick) {
      if (!gapMs) return;
      var remaining = gapMs;
      var chunkIdx = 0;
      var gapEnd = t + gapMs;
      while (remaining > 0) {
        var dur = Math.min(10000, remaining);
        segs.push({
          start: t,
          dur: dur,
          type: "atmo",
          clip: ATMO_CLIPS[(nextPick * 3 + chunkIdx) % ATMO_CLIPS.length],
          nextPick: nextPick,
          gapEnd: gapEnd,
        });
        t += dur;
        remaining -= dur;
        chunkIdx++;
      }
    }

    var coldOpen = fit(COLD_OPEN, voDur("intro"), 1500);
    segs.push({ start: t, dur: coldOpen, type: "coldOpen" });
    t += coldOpen;

    // 2.5s tail so the board slam and the crowd cutaway still land after the call.
    for (var pick = n; pick >= 3; pick--) {
      var d = fit(perPick, voDur("pick", pick), 2500);
      segs.push({ start: t, dur: d, type: "pick", pick: pick, team: order[pick - 1] });
      t += d;
      pushGap(pick - 1);
    }

    var twoRem = fit(TWO_REMAIN, voDur("twoRemain"), 1000);
    segs.push({ start: t, dur: twoRem, type: "twoRemain" });
    t += twoRem;

    if (n >= 2) {
      var d2 = fit(perPick, voDur("pick", 2), 2500);
      segs.push({ start: t, dur: d2, type: "pick", pick: 2, team: order[1] });
      t += d2;
      pushGap(1);
    }

    // The name lands near the end of the call, so the slam (and the confetti with
    // it) has to key off the clip length -- a fixed cue only ever matches one
    // name length, and this is the moment the whole product is selling.
    var finalVo = voDur("pick", 1);
    var slamAt = finalVo ? FINAL_VO_AT + Math.max(0, finalVo - 1500) : FINAL_SLAM;
    var finalDur = Math.max(FINAL_PICK, slamAt + 6500);
    segs.push({
      start: t,
      dur: finalDur,
      type: "finalPick",
      pick: 1,
      team: order[0],
      slamAt: slamAt,
    });
    t += finalDur;

    segs.push({ start: t, dur: Infinity, type: "end" });
    totalDur = t;
    return segs;
  }

  /* ---------- Video ---------- */

  function setClip(src, loop, camClass) {
    if (CLIPS[src]) src = CLIPS[src];
    var next = activeVid === $("vidA") ? $("vidB") : $("vidA");
    var prev = activeVid;
    if (next.getAttribute("data-clip") !== src) {
      next.setAttribute("data-clip", src);
      next.src = src;
    }
    next.loop = !!loop;
    next.currentTime = 0;
    CAMERA_MOVES.forEach(function (c) { next.classList.remove(c); });
    if (camClass && camClass !== "cam-none") next.classList.add(camClass);
    var p = next.play();
    if (p && p.catch) p.catch(function () {});
    next.classList.add("active");
    if (prev) prev.classList.remove("active");
    activeVid = next;
  }

  /* ---------- Audio ---------- */

  function bed() { return $("bedMusic"); }

  function preloadAudio(manifest) {
    if (!manifest) return;
    var add = function (key, url) {
      if (!url) return;
      var a = new Audio(url);
      a.preload = "auto";
      voAudio[key] = a;
    };
    add("intro", manifest.intro);
    add("twoRemain", manifest.twoRemain);
    if (manifest.picks) {
      Object.keys(manifest.picks).forEach(function (p) {
        add("pick" + p, manifest.picks[p]);
      });
    }
  }

  // Refcounted so an earlier line ending can't un-duck the bed while a later
  // one is still talking (late joiners and replays can overlap two clips).
  var ducking = 0;

  function playVO(key) {
    var a = voAudio[key];
    if (!a) return;
    ducking++;
    bed().volume = BED_DUCKED;
    a.currentTime = 0;
    var done = false;
    var restore = function () {
      if (done) return;
      done = true;
      ducking = Math.max(0, ducking - 1);
      if (!ducking) bed().volume = BED_VOLUME;
    };
    a.onended = restore;
    a.onerror = restore;
    var p = a.play();
    if (p && p.catch) p.catch(restore);
  }

  /* ---------- Board ---------- */

  function initBoard(n) {
    var slots = $("boardSlots");
    slots.innerHTML = "";
    for (var pick = 1; pick <= n; pick++) {
      var el = document.createElement("div");
      el.className = "slot";
      el.id = "slot-" + pick;
      el.innerHTML = '<span class="slot-num">' + pick + '</span><span class="slot-name">— — —</span>';
      slots.appendChild(el);
    }
    $("board").classList.toggle("two-col", n > 16);
  }

  function fillSlot(pick, team, opts) {
    var el = $("slot-" + pick);
    if (!el || el.classList.contains("filled")) return;
    el.classList.add("filled");
    el.querySelector(".slot-name").textContent = team;
    if (opts && opts.gold) el.classList.add("gold");
    if (opts && opts.animate) {
      el.classList.add("slam");
      el.scrollIntoView({ block: "nearest" });
    }
  }

  // Late joiners: instantly fill everything already announced.
  function syncBoard(elapsed) {
    segments.forEach(function (seg) {
      if (seg.type !== "pick" && seg.type !== "finalPick") return;
      var announceAt = seg.start + (seg.type === "finalPick" ? 13000 : 5000);
      if (elapsed > announceAt) {
        fillSlot(seg.pick, seg.team, { gold: seg.pick === 1 });
      }
    });
  }

  /* ---------- Chyron ---------- */

  function chyron(text) {
    if (text === null) {
      $("chyron").classList.add("hidden");
      return;
    }
    $("chyron").classList.remove("hidden");
    $("chyronText").textContent = text;
  }

  /* ---------- Segment rendering ---------- */

  function ordSuffix(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function enterSegment(seg, elapsedInSeg) {
    var fresh = elapsedInSeg < 2500; // only fire cues if we arrived near the cue window
    switch (seg.type) {
      case "coldOpen":
        $("board").classList.remove("hidden");
        if (elapsedInSeg < 6000) {
          setClip("arena", false);
          if (fresh) playVO("intro");
          chyron(data.leagueName);
          setTimeout(function () {
            if (currentSeg() && currentSeg().type === "coldOpen") setClip("stage", false);
          }, 6000 - elapsedInSeg);
        } else {
          setClip("stage", false);
          chyron("THE COMMISSIONER IS AT THE PODIUM");
        }
        break;

      case "pick":
        setClip(podiumFor(seg.pick), true, cameraFor(seg.pick));
        chyron("PICK " + ordSuffix(seg.pick) + " · " + data.leagueName);
        if (fresh) playVO("pick" + seg.pick);
        scheduleWithinSeg(seg, 5000, elapsedInSeg, function () {
          fillSlot(seg.pick, seg.team, { animate: true });
          chyron(ordSuffix(seg.pick) + " PICK: " + seg.team.toUpperCase());
        });
        var crowdAt = seg.dur - 3000;
        scheduleWithinSeg(seg, crowdAt, elapsedInSeg, function () {
          setClip(crowdFor(seg.pick), false);
        });
        break;

      case "atmo":
        setClip(seg.clip, true);
        break;

      case "twoRemain":
        setClip("podium", true);
        chyron("TWO REMAIN");
        if (fresh) playVO("twoRemain");
        break;

      case "finalPick":
        setClip(podiumFor(1), true, "cam-push");
        chyron("THE FIRST OVERALL PICK…");
        scheduleWithinSeg(seg, FINAL_VO_AT, elapsedInSeg, function () {
          playVO("pick1");
        });
        scheduleWithinSeg(seg, seg.slamAt || FINAL_SLAM, elapsedInSeg, function () {
          fillSlot(1, seg.team, { animate: true, gold: true });
          chyron("1ST OVERALL: " + seg.team.toUpperCase());
          setClip("confetti", false);
          fireConfetti();
        });
        break;

      case "end":
        showEndScreen();
        break;
    }
  }

  // Fire a cue at segment-relative time `at`, correcting for late arrival.
  function scheduleWithinSeg(seg, at, elapsedInSeg, fn) {
    var delay = at - elapsedInSeg;
    if (delay <= 0) {
      // Cue already passed (late joiner): apply its lasting effects silently.
      fn();
      return;
    }
    setTimeout(function () {
      var cur = currentSeg();
      if (cur === seg) fn();
    }, delay);
  }

  function fireConfetti() {
    if (confettiFired || typeof confetti !== "function") return;
    confettiFired = true;
    var end = Date.now() + 2500;
    (function frame() {
      confetti({ particleCount: 5, angle: 60, spread: 70, origin: { x: 0 }, colors: ["#f5c542", "#0b1220", "#ffffff"] });
      confetti({ particleCount: 5, angle: 120, spread: 70, origin: { x: 1 }, colors: ["#f5c542", "#0b1220", "#ffffff"] });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  /* ---------- Playback loop ---------- */

  function now() { return Date.now() + clockOffset; }
  function elapsed() { return now() - showStart; }

  function currentSeg() {
    if (!segments) return null;
    var e = elapsed();
    for (var i = segments.length - 1; i >= 0; i--) {
      if (e >= segments[i].start) return segments[i];
    }
    return segments[0];
  }

  function tick() {
    var e = elapsed();
    if (e < 0) return; // still pre-show
    var seg = currentSeg();
    var idx = segments.indexOf(seg);
    if (idx !== lastSegIndex) {
      lastSegIndex = idx;
      syncBoard(e);
      enterSegment(seg, e - seg.start);
    }
    if (seg.type === "atmo") {
      var left = Math.max(0, Math.ceil((seg.gapEnd - e) / 1000));
      var m = Math.floor(left / 60);
      var s = left % 60;
      chyron("PICK " + ordSuffix(seg.nextPick) + " COMING UP · " + m + ":" + (s < 10 ? "0" : "") + s);
    }
  }

  function goLive() {
    if (playing || !joined || !data.draftOrder) return;
    playing = true;
    $("waitingRoom").classList.add("hidden");
    $("endScreen").classList.add("hidden");
    initBoard(data.draftOrder.length);
    preloadAudio(data.audioManifest);
    var b = bed();
    if (b.src) {
      b.volume = BED_VOLUME;
      var p = b.play();
      if (p && p.catch) p.catch(function () {});
    }
    lastSegIndex = -1;
    confettiFired = false;
    tickTimer = setInterval(tick, 200);
    tick();
  }

  function showEndScreen() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    playing = false;
    var b = bed();
    b.pause();
    $("endLeague").textContent = data.leagueName;
    var eb = $("endBoard");
    eb.innerHTML = "";
    data.draftOrder.forEach(function (team, i) {
      var el = document.createElement("div");
      el.className = "slot filled" + (i === 0 ? " gold" : "");
      el.innerHTML = '<span class="slot-num">' + (i + 1) + '</span><span class="slot-name"></span>';
      el.querySelector(".slot-name").textContent = team;
      eb.appendChild(el);
    });
    $("endScreen").classList.remove("hidden");
  }

  /* ---------- Waiting room ---------- */

  function fmtCountdown(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (x) { return (x < 10 ? "0" : "") + x; };
    return (d > 0 ? d + "d " : "") + pad(h) + ":" + pad(m) + ":" + pad(sec);
  }

  function renderWaitingRoom() {
    $("wrLeague").textContent = data.leagueName;
    if (data.sealedAt) {
      $("wrSealed").classList.remove("hidden");
      $("wrSealedDate").textContent = new Date(data.sealedAt).toLocaleDateString();
      $("wrHash").textContent = "proof " + String(data.commitmentHash).slice(0, 16) + "…";
    }

    var live = showStart !== null && now() >= showStart;
    $("wrCountdown").classList.toggle("hidden", !(showStart && !live));
    $("wrManualNote").classList.toggle("hidden", !(showStart === null && !HOST_TOKEN));
    $("wrLiveNote").classList.toggle("hidden", !live);
    if (showStart && !live) $("wrClock").textContent = fmtCountdown(showStart - now());

    if (HOST_TOKEN && !IS_DEMO) {
      $("hostPanel").classList.remove("hidden");
      var started = live;
      $("hostStartBtn").classList.toggle("hidden", started);
      $("hostSchedule").classList.toggle("hidden", started);
    }
  }

  function refreshState() {
    fetch("/api/reveal-state?id=" + encodeURIComponent(REVEAL_ID))
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (s.serverNow) clockOffset = Date.parse(s.serverNow) - Date.now();
        showStart = s.showStartedAt ? Date.parse(s.showStartedAt) : null;
        renderWaitingRoom();
        if (showStart !== null && now() >= showStart && !playing) {
          fetchReveal().then(function () {
            if (joined) goLive();
          });
        }
      })
      .catch(function () {});
  }

  function fetchReveal() {
    return fetch("/api/reveal?id=" + encodeURIComponent(REVEAL_ID))
      .then(function (r) {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(function (d) {
        data = d;
        if (d.serverNow) clockOffset = Date.parse(d.serverNow) - Date.now();
        showStart = d.showStartedAt ? Date.parse(d.showStartedAt) : null;
        if (d.draftOrder) segments = buildSegments(d.draftOrder, d.pickGapSeconds || 0);
        return d;
      });
  }

  /* ---------- Host controls ---------- */

  function hostPost(body, msg) {
    body.id = REVEAL_ID;
    body.hostToken = HOST_TOKEN;
    $("hostMsg").textContent = "…";
    return fetch("/api/reveal-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        $("hostMsg").textContent = res.ok ? msg : (res.j.error || "That didn't work");
        refreshState();
      })
      .catch(function () { $("hostMsg").textContent = "Network hiccup, try again"; });
  }

  /* ---------- Boot ---------- */

  function boot() {
    $("bedMusic").src = BED_MUSIC_URL;

    $("joinBtn").addEventListener("click", function () {
      joined = true;
      $("joinBtn").disabled = true;
      $("joinBtn").textContent = "JOINED — WAITING FOR KICKOFF";
      // Prime media under the user gesture so iOS lets us drive them later.
      // These play() promises resolve a tick AFTER this handler returns, and
      // goLive() can run synchronously below — so the unguarded pause() used to
      // land on top of real playback and silence the bed for the whole show.
      var b = bed();
      b.volume = 0;
      var bp = b.play();
      if (bp && bp.then) bp.then(function () {
        if (!playing) { b.pause(); b.currentTime = 0; }
        b.volume = BED_VOLUME;
      }).catch(function () { b.volume = BED_VOLUME; });
      [$("vidA"), $("vidB")].forEach(function (v) {
        v.src = CLIPS.podium;
        var p = v.play();
        if (p && p.then) p.then(function () {
          if (!playing) v.pause();
        }).catch(function () {});
      });
      Object.keys(voAudio).forEach(function (k) { voAudio[k].load(); });

      if (IS_DEMO) {
        showStart = Date.now();
        goLive();
      } else if (showStart !== null && now() >= showStart) {
        if (data.draftOrder) goLive();
        else fetchReveal().then(goLive);
      }
    });

    $("replayBtn").addEventListener("click", function () {
      joined = true;
      showStart = now();
      playing = false;
      lastSegIndex = -1;
      confettiFired = false;
      // Replays run rapid-fire: nobody wants the draft-party gaps twice.
      if (data.draftOrder) segments = buildSegments(data.draftOrder, 0);
      goLive();
    });

    var copyShare = function (inputEl) {
      var url = location.origin + location.pathname + "?id=" + encodeURIComponent(data.revealId);
      if (inputEl) inputEl.value = url;
      if (navigator.clipboard) navigator.clipboard.writeText(url);
    };
    $("copyLink").addEventListener("click", function () { copyShare($("shareLink")); });
    $("endShare").addEventListener("click", function () { copyShare(null); });

    $("hostStartBtn").addEventListener("click", function () {
      if (!confirm("Start the broadcast for everyone right now?")) return;
      hostPost({ action: "start" }, "Broadcast is live");
    });
    $("hostTimeSave").addEventListener("click", function () {
      var v = $("hostTimeInput").value;
      if (!v) { $("hostMsg").textContent = "Pick a date and time first"; return; }
      hostPost({ action: "schedule", scheduledAt: new Date(v).toISOString() }, "Broadcast time saved");
    });
    $("hostGapSave").addEventListener("click", function () {
      hostPost(
        { action: "pacing", pickGapSeconds: Number($("hostGapSelect").value) },
        "Pacing saved"
      );
    });

    if (IS_DEMO) {
      data = DEMO_DATA;
      segments = buildSegments(data.draftOrder, 0);
      preloadAudio(data.audioManifest);
      $("wrLeague").textContent = data.leagueName + " (sample broadcast)";
      $("wrManualNote").classList.add("hidden");
      $("joinBtn").textContent = "WATCH THE SAMPLE BROADCAST";
      return;
    }

    if (!REVEAL_ID) {
      $("waitingRoom").classList.add("hidden");
      $("loadError").classList.remove("hidden");
      return;
    }

    fetchReveal()
      .then(function (d) {
        renderWaitingRoom();
        if (IS_NEW && HOST_TOKEN) {
          $("newPurchase").classList.remove("hidden");
          $("shareLink").value = location.origin + location.pathname + "?id=" + encodeURIComponent(d.revealId);
        }
        if (HOST_TOKEN) {
          if (d.scheduledAt) {
            var dt = new Date(d.scheduledAt);
            $("hostTimeInput").value = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          }
          $("hostGapSelect").value = String(d.pickGapSeconds || 0);
        }
        pollTimer = setInterval(refreshState, 3000);
        setInterval(function () {
          if (!playing && showStart && now() < showStart) {
            $("wrClock").textContent = fmtCountdown(showStart - now());
          }
        }, 500);
      })
      .catch(function () {
        $("waitingRoom").classList.add("hidden");
        $("loadError").classList.remove("hidden");
      });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
