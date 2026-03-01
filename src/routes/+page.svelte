<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WorldMap from '$lib/components/WorldMap.svelte';
  import { formatName, shuffle } from '$lib/quiz.js';
  import { VERSION } from '$lib/version.js';
  import type { Geometry, LandsInfo, Structure, QuizMode } from '$lib/types.js';

  // ── Data ──────────────────────────────────────────────────────────────────

  let geometry: Geometry = $state({});
  let structure: Structure = $state({ continentalRegions: {}, provincialRegions: {}, lands: {} });
  let landsInfo: LandsInfo = $state({});
  let loaded = $state(false);
  let landToContinent: Record<string, string> = {};

  // ── Navigation ────────────────────────────────────────────────────────────

  let currentScope = $state('');

  // ── Quiz state ────────────────────────────────────────────────────────────

  type UIPhase = 'idle' | 'asking' | 'flash-wrong' | 'flash-correct' | 'done';

  let quizActive     = $state(false);
  let uiPhase        = $state<UIPhase>('idle');
  let quizQueue      = $state<string[]>([]);
  let quizIndex      = $state(0);
  let quizScore      = $state(0);
  let foundIds       = $state<string[]>([]);
  let wrongFlashId   = $state('');
  let correctFlashId = $state('');

  // Hint state
  let wrongGuessCount = $state(0);   // wrong guesses for current question
  let hintLevel       = $state(0);   // 0 = none, 1 = text, 2 = pulse ring
  let hintText        = $state('');
  let hintPulseId     = $state('');

  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Speech ────────────────────────────────────────────────────────────────

  let speechEnabled = $state(true);
  let voice: SpeechSynthesisVoice | null = null;

  // Preferred voices in priority order — these sound natural vs the robotic default
  const VOICE_PREFS = [
    'Samantha',               // macOS – best option
    'Karen',                  // macOS Australian
    'Daniel',                 // macOS British
    'Moira',                  // macOS Irish
    'Tessa',                  // macOS South African
    'Google US English',
    'Google UK English Female',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
    'Microsoft Zira Desktop - English (United States)',
  ];

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    for (const name of VOICE_PREFS) {
      const v = voices.find(v => v.name === name);
      if (v) { voice = v; return; }
    }
    // Fall back to first English voice
    voice = voices.find(v => v.lang.startsWith('en-')) ?? voices[0] ?? null;
  }

  function speak(text: string) {
    if (!speechEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate  = 0.88;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    if (feedbackTimer) clearTimeout(feedbackTimer);
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const WORLD_VIEWBOX = '662 -31 10968 5520';

  let currentViewBox  = $derived(scopeDisplayBounds(currentScope));
  let currentRegionIds = $derived(getScopeIds(currentScope));
  let currentTarget   = $derived(
    quizActive && quizIndex < quizQueue.length ? quizQueue[quizIndex] : ''
  );

  // ── Data loading ──────────────────────────────────────────────────────────

  onMount(async () => {
    // Voices load asynchronously in most browsers
    if ('speechSynthesis' in window) {
      pickVoice();
      window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
    }

    [geometry, structure, landsInfo] = await Promise.all([
      fetch('/data/geometry.json').then(r => r.json()),
      fetch('/data/structure.json').then(r => r.json()),
      fetch('/data/lands.json').then(r => r.json())
    ]);
    for (const [region, data] of Object.entries(structure.continentalRegions))
      for (const id of data.landIdentifiers)
        landToContinent[id] = region;
    loaded = true;
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function scopeDisplayBounds(scope: string): string {
    if (!scope) return WORLD_VIEWBOX;
    return structure.continentalRegions[scope]?.displayBounds
      ?? structure.provincialRegions[scope]?.displayBounds
      ?? WORLD_VIEWBOX;
  }

  function getScopeIds(scope: string): string[] {
    if (!scope) {
      const ids: string[] = [];
      for (const data of Object.values(structure.continentalRegions))
        for (const id of data.landIdentifiers)
          if (geometry[id]) ids.push(id);
      return ids;
    }
    const ids =
      structure.continentalRegions[scope]?.landIdentifiers ??
      structure.provincialRegions[scope]?.landIdentifiers ?? [];
    return ids.filter(id => geometry[id]);
  }

  function getQuizModes(scope: string): Array<{ mode: QuizMode; label: string }> {
    const modes: Array<{ mode: QuizMode; label: string }> = [];
    if (structure.continentalRegions[scope]) modes.push({ mode: 'countries', label: 'Countries' });
    const hasStates = Object.entries(structure.provincialRegions).some(
      ([key, val]) => key.startsWith(scope + ':') && val.enabled !== false
    );
    if (hasStates) modes.push({ mode: 'states', label: 'States / Provinces' });
    return modes;
  }

  /** Returns a directional hint for the target within the current scope */
  function buildDirectionalHint(targetId: string, scope: string): string {
    const info = landsInfo[targetId];
    const boundsStr = structure.continentalRegions[scope]?.displayBounds
                   ?? structure.provincialRegions[scope]?.displayBounds ?? '';
    if (!info?.cx || !info?.cy || !boundsStr) return `It's somewhere on this map.`;

    const [bx, by, bw, bh] = boundsStr.split(' ').map(Number);
    const relX = (info.cx - bx) / bw;
    const relY = (info.cy - by) / bh;

    const ns = relY < 0.33 ? 'northern' : relY > 0.66 ? 'southern' : 'central';
    const ew = relX < 0.25 ? 'far western' : relX < 0.45 ? 'western'
             : relX > 0.75 ? 'far eastern' : relX > 0.55 ? 'eastern' : '';
    const dir = [ns, ew].filter(Boolean).join(', ');
    return `It's in the ${dir} part of ${formatName(scope)}.`;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  const CONTINENTAL_REGIONS = [
    'africa', 'antarctica', 'asia', 'central america', 'europe',
    'middle east', 'north america', 'oceania', 'south america'
  ];

  function selectRegion(region: string) {
    clearQuiz();
    currentScope = region;
  }

  function goBack() {
    clearQuiz();
    currentScope = CONTINENTAL_REGIONS.includes(currentScope)
      ? ''
      : (Object.keys(structure.continentalRegions).find(r => currentScope.startsWith(r)) ?? '');
  }

  function startQuiz(mode: QuizMode = 'countries') {
    clearQuiz();
    let ids: string[];
    if (mode === 'states') {
      ids = [];
      for (const [key, data] of Object.entries(structure.provincialRegions))
        if (key.startsWith(currentScope + ':') && data.enabled !== false)
          ids.push(...data.landIdentifiers.filter(id => geometry[id]));
    } else {
      ids = getScopeIds(currentScope);
    }
    if (!ids.length) return;

    quizQueue  = shuffle(ids);
    quizIndex  = 0;
    quizScore  = 0;
    foundIds   = [];
    quizActive = true;
    uiPhase    = 'asking';
    resetHints();
    speak(`Where is ${formatName(quizQueue[0])}?`);
  }

  function clearQuiz() {
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    quizActive     = false;
    uiPhase        = 'idle';
    quizQueue      = [];
    quizIndex      = 0;
    quizScore      = 0;
    foundIds       = [];
    wrongFlashId   = '';
    correctFlashId = '';
    resetHints();
  }

  function resetHints() {
    wrongGuessCount = 0;
    hintLevel       = 0;
    hintText        = '';
    hintPulseId     = '';
  }

  function handleMapClick(id: string) {
    if (!quizActive || uiPhase !== 'asking') return;
    id === currentTarget ? handleCorrect() : handleWrong(id);
  }

  function handleCorrect() {
    quizScore++;
    uiPhase        = 'flash-correct';
    correctFlashId = currentTarget;
    hintPulseId    = '';
    speak(`That is correct! ${formatName(currentTarget)}.`);

    feedbackTimer = setTimeout(() => {
      foundIds       = [...foundIds, correctFlashId];
      correctFlashId = '';
      advanceQuestion();
    }, 1200);
  }

  function handleWrong(clickedId: string) {
    wrongGuessCount++;
    uiPhase      = 'flash-wrong';
    wrongFlashId = clickedId;
    speak(`That's not ${formatName(currentTarget)}, that's ${formatName(clickedId)}.`);

    feedbackTimer = setTimeout(() => {
      wrongFlashId  = '';
      uiPhase       = 'asking';
      feedbackTimer = null;
    }, 1800);
  }

  function useHint() {
    hintLevel++;
    if (hintLevel === 1) {
      hintText = buildDirectionalHint(currentTarget, currentScope);
      speak(hintText);
    } else if (hintLevel === 2) {
      hintPulseId = currentTarget;
      speak(`Look for the pulsing ring on the map.`);
    }
  }

  function advanceQuestion() {
    feedbackTimer = null;
    const next = quizIndex + 1;
    if (next >= quizQueue.length) {
      uiPhase    = 'done';
      quizActive = false;
      const pct  = Math.round((quizScore / quizQueue.length) * 100);
      speak(`Quiz complete. You got ${quizScore} out of ${quizQueue.length}. ${pct} percent.`);
    } else {
      quizIndex = next;
      uiPhase   = 'asking';
      resetHints();
      speak(`Where is ${formatName(quizQueue[next])}?`);
    }
  }

  function handleWorldClick(id: string) {
    const continent = landToContinent[id];
    if (continent) selectRegion(continent);
  }

  function skipQuestion() {
    if (!quizActive || uiPhase !== 'asking') return;
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    speak(`Skipped. The answer was ${formatName(currentTarget)}.`);
    uiPhase        = 'flash-correct';
    correctFlashId = currentTarget;
    hintPulseId    = '';

    feedbackTimer = setTimeout(() => {
      foundIds       = [...foundIds, correctFlashId];
      correctFlashId = '';
      advanceQuestion();
    }, 1800);
  }

  function restartQuiz() {
    const mode: QuizMode = Object.keys(structure.provincialRegions)
      .some(k => k.startsWith(currentScope + ':'))
      ? 'states' : 'countries';
    startQuiz(mode);
  }
</script>

<div class="app">
  <!-- ── Header ─────────────────────────────────────────────── -->
  <header>
    <div class="header-left">
      {#if currentScope}
        <button class="back-btn" onclick={goBack}>← Back</button>
        <span class="scope-label">{formatName(currentScope)}</span>
      {:else}
        <span class="app-title">World of Where</span>
      {/if}
    </div>

    <nav class="region-tabs">
      {#each CONTINENTAL_REGIONS as region}
        <button
          class="tab"
          class:active={currentScope === region}
          onclick={() => selectRegion(region)}
        >{formatName(region)}</button>
      {/each}
    </nav>

    <button
      class="mute-btn"
      title={speechEnabled ? 'Mute speech' : 'Enable speech'}
      onclick={() => { speechEnabled = !speechEnabled; window.speechSynthesis?.cancel(); }}
    >{speechEnabled ? '🔊' : '🔇'}</button>
  </header>

  <!-- ── Map ───────────────────────────────────────────────── -->
  <main class="map-container">
    {#if loaded}
      <WorldMap
        {geometry}
        {landsInfo}
        viewBox={currentViewBox}
        regionIds={currentRegionIds}
        {foundIds}
        {wrongFlashId}
        {correctFlashId}
        {hintPulseId}
        quizActive={quizActive && uiPhase === 'asking'}
        onLandClick={currentScope ? handleMapClick : handleWorldClick}
      />
    {:else}
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading map…</p>
      </div>
    {/if}
  </main>

  <!-- ── Start panel ────────────────────────────────────────── -->
  {#if loaded && currentScope && !quizActive && uiPhase === 'idle'}
    <div class="bottom-panel start-panel">
      <div class="quiz-modes">
        {#each getQuizModes(currentScope) as { mode, label }}
          <button class="start-btn" onclick={() => startQuiz(mode)}>Quiz: {label}</button>
        {/each}
      </div>
      <p class="hint-text">or click any country on the map to explore</p>
    </div>
  {/if}

  <!-- ── Asking panel ───────────────────────────────────────── -->
  {#if quizActive && uiPhase === 'asking'}
    <div class="bottom-panel quiz-panel">
      <div class="question-area">
        <span class="find-label">Find:</span>
        <span class="target-name">{formatName(currentTarget)}</span>
      </div>

      {#if hintText}
        <span class="hint-bubble">{hintText}</span>
      {/if}

      <div class="quiz-actions">
        <span class="score-display">{quizScore} / {quizIndex} found</span>
        {#if wrongGuessCount >= 2 && hintLevel < 2}
          <button class="hint-btn" onclick={useHint}>
            {hintLevel === 0 ? 'Hint' : 'More hint'}
          </button>
        {/if}
        <button class="skip-btn" onclick={skipQuestion}>Skip</button>
        <button class="stop-btn" onclick={clearQuiz}>Stop</button>
      </div>
    </div>
  {/if}

  <!-- ── Wrong flash panel ──────────────────────────────────── -->
  {#if uiPhase === 'flash-wrong'}
    <div class="bottom-panel quiz-panel feedback-panel wrong">
      <span class="feedback-icon">✗</span>
      <span class="feedback-text">
        That's not <strong>{formatName(currentTarget)}</strong>,
        that's <strong>{formatName(wrongFlashId)}</strong>. Keep trying!
      </span>
      <span class="score-display">{quizScore} / {quizIndex} found</span>
    </div>
  {/if}

  <!-- ── Correct flash panel ────────────────────────────────── -->
  {#if uiPhase === 'flash-correct'}
    <div class="bottom-panel quiz-panel feedback-panel correct">
      <span class="feedback-icon">✓</span>
      <span class="feedback-text">That is correct! <strong>{formatName(correctFlashId)}</strong></span>
      <span class="score-display">{quizScore} / {quizIndex + 1} found</span>
    </div>
  {/if}

  <!-- ── Results overlay ────────────────────────────────────── -->
  {#if uiPhase === 'done'}
    <div class="results-overlay">
      <div class="results-card">
        <h2>Quiz Complete!</h2>
        <div class="score-big">{quizScore} / {quizQueue.length}</div>
        <div class="score-pct">{Math.round((quizScore / quizQueue.length) * 100)}%</div>
        {#if quizScore === quizQueue.length}
          <p class="grade perfect">Perfect score!</p>
        {:else if quizScore / quizQueue.length >= 0.8}
          <p class="grade great">Great job!</p>
        {:else if quizScore / quizQueue.length >= 0.5}
          <p class="grade good">Keep practising!</p>
        {:else}
          <p class="grade keep-going">Geography takes time!</p>
        {/if}
        <div class="result-buttons">
          <button class="start-btn" onclick={restartQuiz}>Play Again</button>
          <button class="stop-btn" onclick={clearQuiz}>Back to Map</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Version ────────────────────────────────────────────── -->
  <div class="version-tag">v{VERSION}</div>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    height: 100%; width: 100%; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0d1b2e; color: #e8eaf6;
  }

  .app { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; position: relative; }

  /* Header */
  header {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px;
    background: rgba(10,18,36,0.97);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0; z-index: 10; flex-wrap: wrap;
  }
  .header-left { display: flex; align-items: center; gap: 8px; min-width: 160px; }
  .app-title { font-size: 1.05rem; font-weight: 700; color: #7ec8e3; letter-spacing: 0.02em; }
  .scope-label { font-size: 1rem; font-weight: 600; }
  .back-btn {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    color: #e8eaf6; padding: 4px 10px; border-radius: 6px; cursor: pointer;
    font-size: 0.83rem; transition: background 0.15s;
  }
  .back-btn:hover { background: rgba(255,255,255,0.18); }

  .region-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
  .tab {
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
    color: rgba(232,234,246,0.8); padding: 3px 9px; border-radius: 20px;
    cursor: pointer; font-size: 0.76rem; transition: background 0.15s, color 0.15s; white-space: nowrap;
  }
  .tab:hover { background: rgba(126,200,227,0.2); color: #7ec8e3; }
  .tab.active { background: #7ec8e3; color: #0d1b2e; font-weight: 600; border-color: #7ec8e3; }

  .mute-btn {
    background: none; border: none; cursor: pointer; font-size: 1.1rem;
    padding: 4px 6px; border-radius: 6px; flex-shrink: 0; transition: background 0.15s;
  }
  .mute-btn:hover { background: rgba(255,255,255,0.1); }

  /* Map */
  .map-container { flex: 1; overflow: hidden; position: relative; min-height: 0; }
  .loading {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; gap: 16px; color: rgba(232,234,246,0.6);
  }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(126,200,227,0.2); border-top-color: #7ec8e3;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Bottom panels */
  .bottom-panel {
    flex-shrink: 0; background: rgba(10,18,36,0.97); border-top: 1px solid rgba(255,255,255,0.08);
    padding: 11px 18px; display: flex; align-items: center; gap: 12px; z-index: 10; flex-wrap: wrap;
  }
  .start-panel { justify-content: center; flex-direction: column; gap: 6px; }
  .quiz-modes { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .hint-text { font-size: 0.76rem; color: rgba(232,234,246,0.4); }

  /* Quiz asking */
  .question-area { display: flex; align-items: baseline; gap: 10px; flex: 1; }
  .find-label { font-size: 0.82rem; color: rgba(232,234,246,0.5); text-transform: uppercase; letter-spacing: 0.08em; }
  .target-name { font-size: 1.5rem; font-weight: 700; color: #7ec8e3; }

  .hint-bubble {
    font-size: 0.82rem; color: #ffd43b;
    background: rgba(255,212,59,0.1); border: 1px solid rgba(255,212,59,0.25);
    padding: 3px 10px; border-radius: 12px; flex-shrink: 0;
    max-width: 260px;
  }

  .quiz-actions { display: flex; align-items: center; gap: 8px; }
  .score-display { font-size: 0.87rem; color: rgba(232,234,246,0.55); white-space: nowrap; }

  /* Feedback panels */
  .feedback-panel { min-height: 54px; }
  .feedback-panel.correct { border-top-color: rgba(81,207,102,0.4); background: rgba(20,50,30,0.97); }
  .feedback-panel.wrong   { border-top-color: rgba(255,107,107,0.4); background: rgba(50,15,15,0.97); }
  .feedback-icon { font-size: 1.3rem; font-weight: 700; }
  .feedback-panel.correct .feedback-icon { color: #51cf66; }
  .feedback-panel.wrong   .feedback-icon { color: #ff6b6b; }
  .feedback-text { font-size: 0.97rem; flex: 1; }

  /* Buttons */
  .start-btn {
    background: #7ec8e3; color: #0d1b2e; border: none; padding: 7px 18px;
    border-radius: 20px; cursor: pointer; font-size: 0.88rem; font-weight: 700;
    transition: background 0.15s, transform 0.1s;
  }
  .start-btn:hover { background: #a8ddf0; transform: translateY(-1px); }

  .hint-btn {
    background: rgba(255,212,59,0.15); border: 1px solid rgba(255,212,59,0.4);
    color: #ffd43b; padding: 4px 12px; border-radius: 14px;
    cursor: pointer; font-size: 0.8rem; transition: background 0.15s;
  }
  .hint-btn:hover { background: rgba(255,212,59,0.25); }

  .skip-btn {
    background: rgba(255,255,255,0.09); border: 1px solid rgba(255,255,255,0.2);
    color: rgba(232,234,246,0.75); padding: 4px 12px; border-radius: 14px;
    cursor: pointer; font-size: 0.8rem; transition: background 0.15s;
  }
  .skip-btn:hover { background: rgba(255,255,255,0.16); }

  .stop-btn {
    background: transparent; border: 1px solid rgba(255,107,107,0.4);
    color: rgba(255,107,107,0.75); padding: 4px 12px; border-radius: 14px;
    cursor: pointer; font-size: 0.8rem; transition: background 0.15s;
  }
  .stop-btn:hover { background: rgba(255,107,107,0.12); color: #ff6b6b; }

  /* Results */
  .results-overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.6); z-index: 20;
  }
  .results-card {
    background: #0d1b2e; border: 1px solid rgba(126,200,227,0.3); border-radius: 16px;
    padding: 36px 48px; text-align: center; display: flex; flex-direction: column;
    gap: 10px; box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  }
  .results-card h2 { font-size: 1.3rem; color: #7ec8e3; }
  .score-big { font-size: 3rem; font-weight: 800; line-height: 1; }
  .score-pct { font-size: 1.1rem; color: rgba(232,234,246,0.55); }
  .grade { font-size: 1rem; }
  .perfect    { color: #51cf66; }
  .great      { color: #7ec8e3; }
  .good       { color: #ffd43b; }
  .keep-going { color: rgba(232,234,246,0.55); }
  .result-buttons { display: flex; gap: 12px; justify-content: center; margin-top: 6px; }

  /* Version tag */
  .version-tag {
    position: fixed;
    bottom: 6px;
    right: 10px;
    font-size: 0.68rem;
    color: rgba(232,234,246,0.2);
    pointer-events: none;
    z-index: 30;
    letter-spacing: 0.04em;
  }
</style>
