<script lang="ts">
  import { onMount } from 'svelte';
  import WorldMap from '$lib/components/WorldMap.svelte';
  import { createQuiz, handleAnswer, advance, formatName, shuffle } from '$lib/quiz.js';
  import type {
    Geometry,
    LandsInfo,
    Structure,
    Cities,
    QuizState,
    QuizMode
  } from '$lib/types.js';

  // ── Data ──────────────────────────────────────────────────────────────────

  let geometry: Geometry = $state({});
  let structure: Structure = $state({
    continentalRegions: {},
    provincialRegions: {},
    lands: {}
  });
  let landsInfo: LandsInfo = $state({});
  let cities: Cities = $state({});
  let loaded = $state(false);

  // ── Navigation ────────────────────────────────────────────────────────────

  // '' = world view; 'africa' = Africa; 'north america:usa' = USA states
  let currentScope = $state('');
  let landToContinent: Record<string, string> = {};

  // ── Quiz ──────────────────────────────────────────────────────────────────

  let quiz: QuizState | null = $state(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ───────────────────────────────────────────────────────────────

  const WORLD_VIEWBOX = '662 -31 10968 5520';

  let currentViewBox = $derived(
    scopeDisplayBounds(currentScope) ?? WORLD_VIEWBOX
  );

  let currentRegionIds = $derived(
    getScopeIds(currentScope)
  );

  let quizTargetId = $derived(
    quiz && quiz.phase !== 'done' ? quiz.targetId : ''
  );

  let quizRevealId = $derived(
    quiz && (quiz.phase === 'feedback-wrong') ? quiz.targetId : ''
  );

  let quizClickedId = $derived(quiz?.clickedId ?? '');

  let quizActive = $derived(
    quiz !== null && quiz.phase === 'asking'
  );

  // ── Data loading ──────────────────────────────────────────────────────────

  onMount(async () => {
    [geometry, structure, landsInfo, cities] = await Promise.all([
      fetch('/data/geometry.json').then((r) => r.json()),
      fetch('/data/structure.json').then((r) => r.json()),
      fetch('/data/lands.json').then((r) => r.json()),
      fetch('/data/cities.json').then((r) => r.json())
    ]);

    // Build land → continental region map
    for (const [region, data] of Object.entries(structure.continentalRegions)) {
      for (const id of data.landIdentifiers) {
        landToContinent[id] = region;
      }
    }

    loaded = true;
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function scopeDisplayBounds(scope: string): string | null {
    if (!scope) return WORLD_VIEWBOX;
    // Continental region?
    if (structure.continentalRegions[scope]) {
      return structure.continentalRegions[scope].displayBounds || WORLD_VIEWBOX;
    }
    // Provincial region?
    if (structure.provincialRegions[scope]) {
      return structure.provincialRegions[scope].displayBounds || WORLD_VIEWBOX;
    }
    return WORLD_VIEWBOX;
  }

  function getScopeIds(scope: string): string[] {
    if (!scope) {
      // World view: all top-level country IDs that have geometry
      const ids: string[] = [];
      for (const data of Object.values(structure.continentalRegions)) {
        for (const id of data.landIdentifiers) {
          if (geometry[id]) ids.push(id);
        }
      }
      return ids;
    }
    if (structure.continentalRegions[scope]) {
      return structure.continentalRegions[scope].landIdentifiers.filter(
        (id) => geometry[id]
      );
    }
    if (structure.provincialRegions[scope]) {
      return structure.provincialRegions[scope].landIdentifiers.filter(
        (id) => geometry[id]
      );
    }
    return [];
  }

  function getAvailableQuizModes(scope: string): Array<{ mode: QuizMode; label: string }> {
    const modes: Array<{ mode: QuizMode; label: string }> = [];
    if (structure.continentalRegions[scope]) {
      modes.push({ mode: 'countries', label: 'Countries' });
    }
    // Check if any provincial region is scoped within this continent
    const hasstates = Object.entries(structure.provincialRegions).some(
      ([key, val]) => key.startsWith(scope + ':') && val.enabled !== false
    );
    if (hasstates) {
      modes.push({ mode: 'states', label: 'States / Provinces' });
    }
    return modes;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  const CONTINENTAL_REGIONS = [
    'africa', 'antarctica', 'asia', 'central america', 'europe',
    'middle east', 'north america', 'oceania', 'south america'
  ];

  function selectRegion(region: string) {
    stopQuiz();
    currentScope = region;
  }

  function goBack() {
    stopQuiz();
    // If we're in a provincial view (e.g. "north america:usa"), go up to continent
    const parts = currentScope.split(':');
    if (parts.length > 1 && !CONTINENTAL_REGIONS.includes(currentScope)) {
      // Find parent continental region
      const parent = Object.keys(structure.continentalRegions).find(
        (r) => structure.provincialRegions[currentScope]?.landIdentifiers?.some(
          (id) => landToContinent[id.split(':')[0]] === r
        ) ?? currentScope.startsWith(r)
      );
      currentScope = parent ?? '';
    } else {
      currentScope = '';
    }
  }

  function startQuiz(mode: QuizMode = 'countries') {
    clearFeedback();
    let ids: string[];
    if (mode === 'states') {
      // Find provincial regions within this continent
      ids = [];
      for (const [key, data] of Object.entries(structure.provincialRegions)) {
        if (key.startsWith(currentScope + ':') && data.enabled !== false) {
          ids.push(...data.landIdentifiers.filter((id) => geometry[id]));
        }
      }
    } else {
      ids = getScopeIds(currentScope);
    }
    if (!ids.length) return;
    quiz = createQuiz(currentScope, mode, ids);
  }

  function stopQuiz() {
    clearFeedback();
    quiz = null;
  }

  function clearFeedback() {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
  }

  function handleMapClick(id: string) {
    if (!quiz || quiz.phase !== 'asking') return;
    clearFeedback();
    quiz = handleAnswer(quiz, id);

    const delay = quiz.phase === 'feedback-correct' ? 900 : 2000;
    feedbackTimer = setTimeout(() => {
      if (quiz) {
        quiz = advance(quiz);
        if (quiz.phase === 'done') stopQuiz();
      }
    }, delay);
  }

  function handleWorldClick(id: string) {
    // In world view, clicking selects the continent
    const continent = landToContinent[id];
    if (continent) selectRegion(continent);
  }

  function skipQuestion() {
    if (!quiz || quiz.phase !== 'asking') return;
    clearFeedback();
    // Count as wrong (skipped)
    quiz = { ...quiz, clickedId: '', phase: 'feedback-wrong' };
    feedbackTimer = setTimeout(() => {
      if (quiz) {
        quiz = advance(quiz);
        if (quiz.phase === 'done') stopQuiz();
      }
    }, 1500);
  }

  function restartQuiz() {
    if (!quiz) return;
    const { mode } = quiz;
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

    <nav class="region-tabs" aria-label="Regions">
      {#each CONTINENTAL_REGIONS as region}
        <button
          class="tab"
          class:active={currentScope === region}
          onclick={() => selectRegion(region)}
        >
          {formatName(region)}
        </button>
      {/each}
    </nav>
  </header>

  <!-- ── Map ───────────────────────────────────────────────── -->
  <main class="map-container">
    {#if loaded}
      <WorldMap
        {geometry}
        {landsInfo}
        viewBox={currentViewBox}
        regionIds={currentRegionIds}
        targetId={quizTargetId}
        revealId={quizRevealId}
        clickedId={quizClickedId}
        {quizActive}
        onLandClick={currentScope ? handleMapClick : handleWorldClick}
      />
    {:else}
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading map…</p>
      </div>
    {/if}
  </main>

  <!-- ── Quiz Controls ─────────────────────────────────────── -->
  {#if loaded && currentScope && !quiz}
    <div class="bottom-panel start-panel">
      <div class="quiz-modes">
        {#each getAvailableQuizModes(currentScope) as { mode, label }}
          <button class="start-btn" onclick={() => startQuiz(mode)}>
            Quiz: {label}
          </button>
        {/each}
      </div>
      <p class="hint">or click any country on the map to explore</p>
    </div>
  {/if}

  {#if quiz && quiz.phase === 'asking'}
    <div class="bottom-panel quiz-panel">
      <div class="question-area">
        <span class="find-label">Find:</span>
        <span class="target-name">{formatName(quiz.targetId)}</span>
      </div>
      <div class="quiz-actions">
        <div class="score-display">
          {quiz.score} / {quiz.currentIndex} correct
        </div>
        <button class="skip-btn" onclick={skipQuestion}>Skip</button>
        <button class="stop-btn" onclick={stopQuiz}>Stop</button>
      </div>
    </div>
  {/if}

  {#if quiz && (quiz.phase === 'feedback-correct' || quiz.phase === 'feedback-wrong')}
    <div class="bottom-panel quiz-panel feedback-panel" class:correct={quiz.phase === 'feedback-correct'} class:wrong={quiz.phase === 'feedback-wrong'}>
      {#if quiz.phase === 'feedback-correct'}
        <span class="feedback-icon">✓</span>
        <span class="feedback-text">Correct! <strong>{formatName(quiz.targetId)}</strong></span>
      {:else}
        <span class="feedback-icon">✗</span>
        <span class="feedback-text">
          {quiz.clickedId ? `That was ${formatName(quiz.clickedId)} — ` : ''}The answer was <strong>{formatName(quiz.targetId)}</strong>
        </span>
      {/if}
      <div class="score-display">{quiz.score} / {quiz.currentIndex + 1}</div>
    </div>
  {/if}

  {#if quiz && quiz.phase === 'done'}
    <div class="results-overlay">
      <div class="results-card">
        <h2>Quiz Complete!</h2>
        <div class="score-big">{quiz.score} / {quiz.queue.length}</div>
        <div class="score-pct">{Math.round((quiz.score / quiz.queue.length) * 100)}%</div>
        {#if quiz.score === quiz.queue.length}
          <p class="perfect">Perfect score! 🌍</p>
        {:else if quiz.score / quiz.queue.length >= 0.8}
          <p class="great">Great job!</p>
        {:else if quiz.score / quiz.queue.length >= 0.5}
          <p class="good">Keep practising!</p>
        {:else}
          <p class="keep-going">Keep at it — geography takes time!</p>
        {/if}
        <div class="result-buttons">
          <button class="start-btn" onclick={restartQuiz}>Play Again</button>
          <button class="stop-btn" onclick={stopQuiz}>Back to Map</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(html, body) {
    height: 100%;
    width: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0d1b2e;
    color: #e8eaf6;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  /* ── Header ─────────────────────────────────────────────── */

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: rgba(10, 18, 36, 0.95);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    z-index: 10;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 180px;
  }

  .app-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #7ec8e3;
    letter-spacing: 0.02em;
  }

  .scope-label {
    font-size: 1rem;
    font-weight: 600;
    color: #e8eaf6;
  }

  .back-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #e8eaf6;
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.15s;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  /* ── Region Tabs ─────────────────────────────────────────── */

  .region-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .tab {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(232, 234, 246, 0.8);
    padding: 4px 10px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.78rem;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .tab:hover {
    background: rgba(126, 200, 227, 0.2);
    color: #7ec8e3;
  }

  .tab.active {
    background: #7ec8e3;
    color: #0d1b2e;
    font-weight: 600;
    border-color: #7ec8e3;
  }

  /* ── Map ─────────────────────────────────────────────────── */

  .map-container {
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 16px;
    color: rgba(232, 234, 246, 0.6);
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(126, 200, 227, 0.2);
    border-top-color: #7ec8e3;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Bottom Panel ────────────────────────────────────────── */

  .bottom-panel {
    flex-shrink: 0;
    background: rgba(10, 18, 36, 0.95);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    z-index: 10;
    flex-wrap: wrap;
  }

  .start-panel {
    justify-content: center;
    flex-direction: column;
    gap: 8px;
  }

  .quiz-modes {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .hint {
    font-size: 0.78rem;
    color: rgba(232, 234, 246, 0.45);
  }

  /* ── Quiz Panel ──────────────────────────────────────────── */

  .quiz-panel {
    min-height: 60px;
  }

  .question-area {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex: 1;
  }

  .find-label {
    font-size: 0.85rem;
    color: rgba(232, 234, 246, 0.55);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .target-name {
    font-size: 1.5rem;
    font-weight: 700;
    color: #7ec8e3;
  }

  .quiz-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .score-display {
    font-size: 0.9rem;
    color: rgba(232, 234, 246, 0.6);
    white-space: nowrap;
  }

  .feedback-panel {
    justify-content: space-between;
  }

  .feedback-panel.correct {
    border-top-color: rgba(81, 207, 102, 0.4);
    background: rgba(30, 60, 40, 0.95);
  }

  .feedback-panel.wrong {
    border-top-color: rgba(255, 107, 107, 0.4);
    background: rgba(60, 20, 20, 0.95);
  }

  .feedback-icon {
    font-size: 1.4rem;
    font-weight: 700;
  }

  .feedback-panel.correct .feedback-icon { color: #51cf66; }
  .feedback-panel.wrong .feedback-icon { color: #ff6b6b; }

  .feedback-text {
    font-size: 1rem;
    flex: 1;
  }

  /* ── Buttons ─────────────────────────────────────────────── */

  .start-btn {
    background: #7ec8e3;
    color: #0d1b2e;
    border: none;
    padding: 8px 20px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 700;
    transition: background 0.15s, transform 0.1s;
  }

  .start-btn:hover {
    background: #a8ddf0;
    transform: translateY(-1px);
  }

  .skip-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(232, 234, 246, 0.8);
    padding: 5px 14px;
    border-radius: 14px;
    cursor: pointer;
    font-size: 0.82rem;
    transition: background 0.15s;
  }

  .skip-btn:hover { background: rgba(255, 255, 255, 0.18); }

  .stop-btn {
    background: transparent;
    border: 1px solid rgba(255, 107, 107, 0.4);
    color: rgba(255, 107, 107, 0.8);
    padding: 5px 14px;
    border-radius: 14px;
    cursor: pointer;
    font-size: 0.82rem;
    transition: background 0.15s;
  }

  .stop-btn:hover {
    background: rgba(255, 107, 107, 0.15);
    color: #ff6b6b;
  }

  /* ── Results Overlay ─────────────────────────────────────── */

  .results-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.65);
    z-index: 20;
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    height: 100%;
  }

  .results-card {
    background: #0d1b2e;
    border: 1px solid rgba(126, 200, 227, 0.3);
    border-radius: 16px;
    padding: 36px 48px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  }

  .results-card h2 {
    font-size: 1.4rem;
    color: #7ec8e3;
  }

  .score-big {
    font-size: 3rem;
    font-weight: 800;
    color: #e8eaf6;
    line-height: 1;
  }

  .score-pct {
    font-size: 1.2rem;
    color: rgba(232, 234, 246, 0.6);
  }

  .perfect { color: #51cf66; }
  .great   { color: #7ec8e3; }
  .good    { color: #ffd43b; }
  .keep-going { color: rgba(232, 234, 246, 0.6); }

  .result-buttons {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 8px;
  }
</style>
